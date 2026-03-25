import * as vscode from 'vscode';
import { SvnAnnotation } from './types';
import { SvnProvider } from './svn-provider';

export class HoverProvider implements vscode.HoverProvider {
  private static instance: HoverProvider;
  private svnProvider: SvnProvider;
  private hoverDebounceTimer: NodeJS.Timeout | null = null;

  private constructor() {
    this.svnProvider = SvnProvider.getInstance();
  }

  public static getInstance(): HoverProvider {
    if (!HoverProvider.instance) {
      HoverProvider.instance = new HoverProvider();
    }
    return HoverProvider.instance;
  }

  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    if (!this.svnProvider.isLoggedIn()) {
      return null;
    }

    if (token.isCancellationRequested) {
      return null;
    }

    const filePath = document.uri.fsPath;
    const lineNumber = position.line;

    try {
      const annotation = await this.svnProvider.getAnnotationForLine(filePath, document, lineNumber);

      if (!annotation) {
        if (this.svnProvider.isPending(filePath)) {
          return this.createLoadingHover();
        }
        return null;
      }

      if (annotation.revision) {
        const commitMessage = await this.svnProvider.getCommitMessage(filePath, annotation.revision);
        if (commitMessage) {
          annotation.message = commitMessage;
        }
      }

      return this.createHover(annotation, filePath);
    } catch (error) {
      console.error('Hover failed:', error);
      return null;
    }
  }

  private createLoadingHover(): vscode.Hover {
    const mdString = new vscode.MarkdownString();
    mdString.appendMarkdown(`*$(sync~spin) Loading SVN annotation...*`);
    return new vscode.Hover(mdString);
  }

  private createHover(annotation: SvnAnnotation, filePath: string): vscode.Hover {
    const mdString = new vscode.MarkdownString();
    mdString.isTrusted = true;

    const dateStr = this.formatDate(annotation.date);
    const message = annotation.message || '*No commit message*';

    mdString.appendMarkdown('## SVN Annotation\n\n');
    mdString.appendMarkdown(`**Author:** ${this.escapeMarkdown(annotation.author)}  \n`);
    mdString.appendMarkdown(`**Date:** ${dateStr}  \n`);
    mdString.appendMarkdown(`**Revision:** \`${annotation.revision || 'N/A'}\`  \n`);
    mdString.appendMarkdown(`**Message:** ${message}\n\n`);
    mdString.appendMarkdown('---  \n');
    mdString.appendMarkdown(`[View Changes](command:svnAnnotator.viewChanges?${encodeURIComponent(JSON.stringify({ filePath, revision: annotation.revision }))})`);

    return new vscode.Hover(mdString);
  }

  private escapeMarkdown(text: string): string {
    return text.replace(/([*_`\[\]])/g, '\\$1');
  }

  private formatDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) {
      return 'Unknown';
    }
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return 'Today ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return `${days} days ago`;
    } else {
      return d.toLocaleDateString();
    }
  }

  public clearCache(): void {}
}

export class ViewChangesCommand {
  private static instance: ViewChangesCommand;
  private svnProvider: SvnProvider;

  private constructor() {
    this.svnProvider = SvnProvider.getInstance();
  }

  public static getInstance(): ViewChangesCommand {
    if (!ViewChangesCommand.instance) {
      ViewChangesCommand.instance = new ViewChangesCommand();
    }
    return ViewChangesCommand.instance;
  }

  public async execute(args: { filePath: string; revision: string }): Promise<void> {
    if (!args || !args.filePath) {
      vscode.window.showErrorMessage('Invalid file path');
      return;
    }

    const revision = args.revision || 'HEAD';
    const filePath = args.filePath;
    const config = vscode.workspace.getConfiguration('svnAnnotator');
    const svnPath = config.get<string>('svnPath', 'svn');
    const { leftRevision, rightRevision } = this.getRevisionPair(revision);

    try {
      const [leftContent, rightContent] = await Promise.all([
        this.readFileAtRevision(svnPath, filePath, leftRevision, true),
        this.readFileAtRevision(svnPath, filePath, rightRevision, false)
      ]);

      const leftUri = await this.writeTempDiffFile(filePath, leftRevision, 'left', leftContent);
      const rightUri = await this.writeTempDiffFile(filePath, rightRevision, 'right', rightContent);

      const title = `SVN Diff ${leftRevision} ↔ ${rightRevision} (${this.getBaseName(filePath)})`;
      await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside
      });
    } catch (error: any) {
      vscode.window.showErrorMessage(`查看变更失败: ${error?.message || 'Unknown error'}`);
    }
  }

  private getLoadingHtml(): string {
    return `<!DOCTYPE html>
<html>
<head><style>body { font-family: Arial; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; } .spinner { animation: spin 1s linear infinite; } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } </style></head>
<body><div style="text-align:center"><div class="spinner">⟳</div><p>Loading...</p></div></body>
</html>`;
  }

  private getErrorHtml(message: string): string {
    return `<!DOCTYPE html>
<html>
<head><style>body { font-family: Arial; padding: 20px; } .error { color: #c00; background: #fee; padding: 15px; border-radius: 5px; } </style></head>
<body><div class="error"><h3>Error</h3><p>${this.escapeHtml(message)}</p></div></body>
</html>`;
  }

  private escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private buildCredentialArgs(): string {
    const credentials = this.svnProvider.getCredentials();
    if (!credentials) {
      return '';
    }
    return ` --non-interactive --username "${credentials.username}" --password "${credentials.password}"`;
  }

  private getRevisionPair(revision: string): { leftRevision: string; rightRevision: string } {
    if (/^\d+$/.test(revision)) {
      const right = Number(revision);
      const left = Math.max(1, right - 1);
      return { leftRevision: String(left), rightRevision: String(right) };
    }
    return { leftRevision: 'PREV', rightRevision: revision };
  }

  private async readFileAtRevision(
    svnPath: string,
    filePath: string,
    revision: string,
    allowMissing: boolean
  ): Promise<string> {
    const { exec } = await import('child_process');
    const pegPath = this.withPegRevision(filePath, 'HEAD');
    const cmd = `${svnPath} cat -r ${revision} "${pegPath}"${this.buildCredentialArgs()}`;

    return new Promise((resolve, reject) => {
      exec(cmd, { timeout: 30000, encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          const errText = this.decodeSvnOutput((stderr as unknown as Buffer) || Buffer.from(error.message, 'utf8'));
          if (allowMissing && this.isMissingAtRevisionError(errText)) {
            resolve('');
            return;
          }
          reject(error);
          return;
        }
        resolve(this.decodeSvnOutput(stdout as unknown as Buffer));
      });
    });
  }

  private withPegRevision(filePath: string, pegRevision: string): string {
    if (filePath.includes('@')) {
      return filePath;
    }
    return `${filePath}@${pegRevision}`;
  }

  private isMissingAtRevisionError(errorText: string): boolean {
    return /E195012|E160013|E200009|Unable to find repository location/i.test(errorText);
  }

  private async writeTempDiffFile(
    filePath: string,
    revision: string,
    side: 'left' | 'right',
    content: string
  ): Promise<vscode.Uri> {
    const os = await import('os');
    const path = await import('path');
    const baseName = this.getBaseName(filePath).replace(/[^\w.\-]/g, '_');
    const dir = path.join(os.tmpdir(), 'svn-annotator-diff');
    const dirUri = vscode.Uri.file(dir);
    await vscode.workspace.fs.createDirectory(dirUri);
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fileName = `${unique}-${side}-r${revision}-${baseName}`;
    const fileUri = vscode.Uri.file(path.join(dir, fileName));
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
    return fileUri;
  }

  private getBaseName(filePath: string): string {
    const parts = filePath.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || filePath;
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
}
