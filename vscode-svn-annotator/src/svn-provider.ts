import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as fs from 'fs';
import { SvnAnnotation, SvnLoginInfo, LoginResult, CacheEntry } from './types';
import { Config } from './config';

const ENTRY_REGEX = /<entry[^>]*revision="([^"]*)"[^>]*>[\s\S]*?<author>([^<]*)<\/author>[\s\S]*?<date>([^<]*)<\/date>[\s\S]*?<\/entry>/g;
const LINE_REGEX = /<line[^>]*revision="([^"]*)"[^>]*(?:>([^<]*)<\/line>|\/>)/g;

export class SvnProvider {
  private static instance: SvnProvider;
  private loginInfo: SvnLoginInfo = { username: '', password: '', isLoggedIn: false };
  private cache: Map<string, CacheEntry> = new Map();
  private logMessageCache: Map<string, string> = new Map();
  private pendingRequests: Map<string, boolean> = new Map();
  private config: Config;

  private constructor() {
    this.config = Config.getInstance();
  }

  public static getInstance(): SvnProvider {
    if (!SvnProvider.instance) {
      SvnProvider.instance = new SvnProvider();
    }
    return SvnProvider.instance;
  }

  public isLoggedIn(): boolean {
    return this.loginInfo.isLoggedIn;
  }

  public async login(username: string, password: string): Promise<LoginResult> {
    return new Promise((resolve) => {
      const svnPath = this.config.svnPath;
      const cmd = `${svnPath} --version --quiet`;

      exec(cmd, { timeout: 10000 }, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, error: stderr || error.message });
          return;
        }
        this.loginInfo = { username, password, isLoggedIn: true };
        resolve({ success: true });
      });
    });
  }

  public logout(): void {
    this.loginInfo = { username: '', password: '', isLoggedIn: false };
  }

  public getCredentials(): { username: string; password: string } | null {
    if (!this.loginInfo.isLoggedIn || !this.loginInfo.username) {
      return null;
    }
    return {
      username: this.loginInfo.username,
      password: this.loginInfo.password
    };
  }

  public async getBlame(filePath: string, document: vscode.TextDocument): Promise<SvnAnnotation[]> {
    const cacheKey = this.getCacheKey(filePath, document);
    const cached = this.getFromCache(cacheKey, document);
    if (cached) {
      return cached;
    }

    if (this.pendingRequests.get(cacheKey)) {
      return [];
    }

    this.pendingRequests.set(cacheKey, true);

    try {
      const annotations = await this.fetchBlame(filePath, document);
      await this.enrichAnnotationsWithMessages(filePath, annotations);
      this.pendingRequests.delete(cacheKey);

      if (this.config.cacheEnabled) {
        this.saveToCache(cacheKey, annotations, document);
      }

      return annotations;
    } catch (error) {
      this.pendingRequests.delete(cacheKey);
      throw error;
    }
  }

  private getCacheKey(filePath: string, document: vscode.TextDocument): string {
    const modifiedTime = fs.existsSync(filePath) ? fs.statSync(filePath).mtimeMs : 0;
    return `${filePath}:${modifiedTime}`;
  }

  private getFromCache(cacheKey: string, document: vscode.TextDocument): SvnAnnotation[] | null {
    if (!this.config.cacheEnabled) { return null; }

    const entry = this.cache.get(cacheKey);
    if (!entry) { return null; }

    const now = Date.now();
    const ttlMs = this.config.cacheTTL * 1000;
    if (now - entry.timestamp > ttlMs) {
      this.cache.delete(cacheKey);
      return null;
    }

    if (!fs.existsSync(document.uri.fsPath)) { return null; }

    const fileModifiedTime = fs.statSync(document.uri.fsPath).mtimeMs;
    if (entry.fileModifiedTime !== fileModifiedTime) {
      this.cache.delete(cacheKey);
      return null;
    }

    return entry.annotations;
  }

  private saveToCache(cacheKey: string, annotations: SvnAnnotation[], document: vscode.TextDocument): void {
    this.enforceCacheLimit();

    this.cache.set(cacheKey, {
      annotations,
      timestamp: Date.now(),
      filePath: document.uri.fsPath,
      fileModifiedTime: fs.statSync(document.uri.fsPath).mtimeMs
    });
  }

  private enforceCacheLimit(): void {
    const maxCache = this.config.maxCacheFiles;
    if (this.cache.size >= maxCache) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) { this.cache.delete(oldestKey); }
    }
  }

  private async fetchBlame(filePath: string, document: vscode.TextDocument): Promise<SvnAnnotation[]> {
    return new Promise((resolve, reject) => {
      const svnPath = this.config.svnPath;
      let cmd = `${svnPath} blame "${filePath}" --xml`;

      if (this.loginInfo.isLoggedIn && this.loginInfo.username) {
        cmd += ` --non-interactive --username "${this.loginInfo.username}"`;
        if (this.loginInfo.password) {
          cmd += ` --password "${this.loginInfo.password}"`;
        }
      }

      exec(cmd, { timeout: 60000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout) => {
        if (error) {
          vscode.window.showWarningMessage(`SVN blame failed: ${error.message}`);
          reject(error);
          return;
        }

        try {
          const annotations = this.parseBlameXml(stdout, document);
          resolve(annotations);
        } catch (parseError) {
          reject(parseError);
        }
      });
    });
  }

  private async enrichAnnotationsWithMessages(filePath: string, annotations: SvnAnnotation[]): Promise<void> {
    const revisions = Array.from(
      new Set(
        annotations
          .map(a => (a.revision || '').trim())
          .filter(r => !!r)
      )
    );

    const messageMap = new Map<string, string>();
    await Promise.all(
      revisions.map(async (revision) => {
        const message = await this.getCommitMessage(filePath, revision);
        if (message) {
          messageMap.set(revision, message);
        }
      })
    );

    for (const annotation of annotations) {
      if (!annotation.revision) {
        continue;
      }
      const msg = messageMap.get(annotation.revision);
      if (msg) {
        annotation.message = msg;
      }
    }
  }

  private parseBlameXml(xmlOutput: string, document: vscode.TextDocument): SvnAnnotation[] {
    const lines = document.getText().split('\n');
    const annotations: SvnAnnotation[] = lines.map((line, index) => ({
      lineNumber: index + 1,
      author: 'Unknown',
      date: new Date(),
      message: '',
      revision: '',
      shortRevision: ''
    }));

    let parsedCount = 0;
    const entryBlockRegex = /<entry\b[^>]*line-number="(\d+)"[^>]*>([\s\S]*?)<\/entry>/g;
    let entryMatch: RegExpExecArray | null;

    while ((entryMatch = entryBlockRegex.exec(xmlOutput)) !== null) {
      const lineNumber = Number(entryMatch[1]);
      const entryXml = entryMatch[2];
      const index = lineNumber - 1;

      if (index < 0 || index >= annotations.length) {
        continue;
      }

      const commitMatch = entryXml.match(/<commit\b[^>]*revision="([^"]+)"[^>]*>([\s\S]*?)<\/commit>/);
      if (!commitMatch) {
        continue;
      }

      const revision = commitMatch[1] || '';
      const commitBody = commitMatch[2] || '';
      const author = (commitBody.match(/<author>([\s\S]*?)<\/author>/)?.[1] || 'Unknown').trim();
      const dateRaw = (commitBody.match(/<date>([\s\S]*?)<\/date>/)?.[1] || '').trim();
      const parsedDate = dateRaw ? new Date(dateRaw) : new Date();

      annotations[index] = {
        lineNumber,
        author: author || 'Unknown',
        date: isNaN(parsedDate.getTime()) ? new Date() : parsedDate,
        message: '',
        revision,
        shortRevision: revision.length > 6 ? revision.substring(0, 6) : revision
      };
      parsedCount++;
    }

    if (parsedCount === 0) {
      const genericEntryRegex = /<entry\b([^>]*)>([\s\S]*?)<\/entry>/g;
      let genericMatch: RegExpExecArray | null;
      let sequence = 0;

      while ((genericMatch = genericEntryRegex.exec(xmlOutput)) !== null) {
        const attrs = genericMatch[1] || '';
        const body = genericMatch[2] || '';
        const lineNumberAttr = attrs.match(/\bline-number="(\d+)"/)?.[1];
        const lineNumber = lineNumberAttr ? Number(lineNumberAttr) : sequence + 1;
        const index = lineNumber - 1;
        if (index < 0 || index >= annotations.length) {
          sequence++;
          continue;
        }

        const commitMatch = body.match(/<commit\b[^>]*revision="([^"]+)"[^>]*>([\s\S]*?)<\/commit>/);
        const revisionFromAttr = attrs.match(/\brevision="([^"]+)"/)?.[1] || '';
        const revision = (commitMatch?.[1] || revisionFromAttr || '').trim();
        const commitOrBody = commitMatch?.[2] || body;
        const author = (commitOrBody.match(/<author>([\s\S]*?)<\/author>/)?.[1] || 'Unknown').trim();
        const dateRaw = (commitOrBody.match(/<date>([\s\S]*?)<\/date>/)?.[1] || '').trim();
        const parsedDate = dateRaw ? new Date(dateRaw) : new Date();

        annotations[index] = {
          lineNumber,
          author: author || 'Unknown',
          date: isNaN(parsedDate.getTime()) ? new Date() : parsedDate,
          message: '',
          revision,
          shortRevision: revision.length > 6 ? revision.substring(0, 6) : revision
        };
        sequence++;
      }
    }

    return annotations;
  }

  public clearCache(): void {
    this.cache.clear();
    this.logMessageCache.clear();
  }

  public clearCacheForFile(filePath: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(filePath)) {
        this.cache.delete(key);
      }
    }
    for (const key of this.logMessageCache.keys()) {
      if (key.startsWith(`${filePath}:`)) {
        this.logMessageCache.delete(key);
      }
    }
  }

  public async getCommitMessage(filePath: string, revision: string): Promise<string | null> {
    if (!revision) {
      return null;
    }

    const cacheKey = `${filePath}:${revision}`;
    const cached = this.logMessageCache.get(cacheKey);
    if (cached !== undefined) {
      return cached || null;
    }

    return new Promise((resolve) => {
      const svnPath = this.config.svnPath;
      const isNumericRevision = /^\d+$/.test(revision);
      let cmd = isNumericRevision
        ? `${svnPath} log -r ${revision} "${filePath}" --xml`
        : `${svnPath} log -r ${revision} "${filePath}" --xml`;

      if (this.loginInfo.isLoggedIn && this.loginInfo.username) {
        cmd += ` --non-interactive --username "${this.loginInfo.username}"`;
        if (this.loginInfo.password) {
          cmd += ` --password "${this.loginInfo.password}"`;
        }
      }

      exec(cmd, { timeout: 30000, maxBuffer: 10 * 1024 * 1024, encoding: 'buffer' }, (error, stdout) => {
        if (error || !stdout) {
          this.logMessageCache.set(cacheKey, '');
          resolve(null);
          return;
        }

        const text = this.decodeSvnOutput(stdout as unknown as Buffer);
        const message = (text.match(/<msg>([\s\S]*?)<\/msg>/)?.[1] || '').trim();
        this.logMessageCache.set(cacheKey, message);
        resolve(message || null);
      });
    });
  }

  private decodeSvnOutput(output: Buffer): string {
    const utf8Text = output.toString('utf8');
    if (!utf8Text.includes('�')) {
      return utf8Text;
    }
    try {
      const decoder = new TextDecoder('gbk');
      return decoder.decode(output);
    } catch {
      return utf8Text;
    }
  }

  public async getAnnotationForLine(
    filePath: string,
    document: vscode.TextDocument,
    lineNumber: number
  ): Promise<SvnAnnotation | null> {
    const cached = this.cache.get(this.getCacheKey(filePath, document));
    if (cached) {
      return cached.annotations[lineNumber] || null;
    }

    const annotations = await this.getBlame(filePath, document);
    return annotations[lineNumber] || null;
  }

  public isPending(filePath: string): boolean {
    for (const key of this.pendingRequests.keys()) {
      if (key.startsWith(`${filePath}:`)) {
        return true;
      }
    }
    return false;
  }
}
