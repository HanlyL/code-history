import * as vscode from 'vscode';
import { SvnAnnotation } from './types';
import { SvnProvider } from './svn-provider';
import { Config } from './config';

export class Annotator {
  private static instance: Annotator;
  private svnProvider: SvnProvider;
  private config: Config;
  private decorationCollection: vscode.TextEditorDecorationType | undefined;
  private debounceTimer: NodeJS.Timeout | null = null;
  private isEnabled: boolean = true;
  private statusBarItem: vscode.StatusBarItem | undefined;
  private activeEditor: vscode.TextEditor | undefined;
  private currentDecorations: Map<string, vscode.DecorationOptions> = new Map();
  private selectedLineByFile: Map<string, number> = new Map();

  private constructor() {
    this.svnProvider = SvnProvider.getInstance();
    this.config = Config.getInstance();
    this.createDecorationCollection();
    this.createStatusBarItem();
  }

  public static getInstance(): Annotator {
    if (!Annotator.instance) {
      Annotator.instance = new Annotator();
    }
    return Annotator.instance;
  }

  private createDecorationCollection(): void {
    if (this.decorationCollection) {
      this.decorationCollection.dispose();
    }
    this.decorationCollection = vscode.window.createTextEditorDecorationType({
      after: {
        margin: '0 0 0 1em',
        fontStyle: 'normal',
        fontWeight: 'normal'
      }
    });
  }

  private createStatusBarItem(): void {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.updateStatusBar();
    this.statusBarItem.show();
  }

  private updateStatusBar(isLoading: boolean = false): void {
    if (!this.statusBarItem) { return; }

    if (!this.svnProvider.isLoggedIn()) {
      this.statusBarItem.text = '$(warning) SVN';
      this.statusBarItem.tooltip = 'SVN Annotator - Not logged in (click to login)';
      this.statusBarItem.command = 'svnAnnotator.login';
      this.statusBarItem.color = 'rgba(255,180,0,0.8)';
    } else if (isLoading) {
      this.statusBarItem.text = '$(sync~spin) SVN';
      this.statusBarItem.tooltip = 'SVN Annotator - Loading...';
      this.statusBarItem.command = undefined;
      this.statusBarItem.color = undefined;
    } else if (this.isEnabled) {
      this.statusBarItem.text = '$(git-commit) SVN';
      this.statusBarItem.tooltip = 'SVN Annotator - Active (click to refresh)';
      this.statusBarItem.command = 'svnAnnotator.refresh';
      this.statusBarItem.color = undefined;
    } else {
      this.statusBarItem.text = '$(circle-slash) SVN';
      this.statusBarItem.tooltip = 'SVN Annotator - Disabled (click to enable)';
      this.statusBarItem.command = 'svnAnnotator.enable';
      this.statusBarItem.color = 'rgba(150,150,150,0.8)';
    }
  }

  public isAnnotatorEnabled(): boolean {
    return this.isEnabled;
  }

  public enable(): void {
    this.isEnabled = true;
    this.updateStatusBar();
    if (this.activeEditor) {
      this.updateAnnotations(this.activeEditor);
    }
  }

  public disable(): void {
    this.isEnabled = false;
    this.updateStatusBar();
    if (this.decorationCollection && this.activeEditor) {
      this.activeEditor.setDecorations(this.decorationCollection, []);
      this.currentDecorations.clear();
    }
  }

  public toggle(): void {
    if (this.isEnabled) {
      this.disable();
    } else {
      this.enable();
    }
  }

  public async updateAnnotations(editor: vscode.TextEditor): Promise<void> {
    if (!this.isEnabled) { return; }
    if (!editor || !editor.document) { return; }

    this.activeEditor = editor;
    const document = editor.document;
    if (document.uri.scheme !== 'file') { return; }

    const filePath = document.uri.fsPath;
    const selectedLine = this.selectedLineByFile.get(filePath);
    if (selectedLine === undefined) {
      if (this.decorationCollection) {
        editor.setDecorations(this.decorationCollection, []);
      }
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      await this.performAnnotationUpdate(editor, document, selectedLine);
    }, 100);
  }

  private async performAnnotationUpdate(editor: vscode.TextEditor, document: vscode.TextDocument, selectedLine: number): Promise<void> {
    const filePath = document.uri.fsPath;

    if (!this.svnProvider.isLoggedIn()) {
      this.updateStatusBar();
      this.showLoginWarning();
      return;
    }

    try {
      this.updateStatusBar(true);

      const annotations = await this.svnProvider.getBlame(filePath, document);

      this.renderAnnotations(editor, annotations, selectedLine);
    } catch (error) {
      console.error('Failed to get SVN annotations:', error);
    } finally {
      this.updateStatusBar(false);
    }
  }

  private showLoginWarning(): void {
    vscode.window.showInformationMessage(
      'SVN Annotator: Please login to SVN to enable annotations.',
      'Login Now'
    ).then(selection => {
      if (selection === 'Login Now') {
        vscode.commands.executeCommand('svnAnnotator.login');
      }
    });
  }

  private renderAnnotations(editor: vscode.TextEditor, annotations: SvnAnnotation[], selectedLine: number): void {
    if (!this.decorationCollection) { return; }

    const filePath = editor.document.uri.fsPath;
    const decorations: vscode.DecorationOptions[] = [];
    this.currentDecorations.clear();

    if (selectedLine < 0 || selectedLine >= editor.document.lineCount) {
      this.selectedLineByFile.delete(filePath);
      editor.setDecorations(this.decorationCollection, []);
      return;
    }

    const annotation = annotations[selectedLine];
    if (annotation) {
      const lineLength = editor.document.lineAt(selectedLine).text.length;
      const range = new vscode.Range(selectedLine, lineLength, selectedLine, lineLength);

      const annotationText = this.formatAnnotationText(annotation);
      if (annotationText) {
        const hoverMessage = this.createHoverMessage(annotation, filePath);
        const decoration = {
          range,
          hoverMessage,
          renderOptions: {
            after: {
              contentText: annotationText,
              color: new vscode.ThemeColor('editorCodeLens.foreground')
            }
          }
        };
        this.currentDecorations.set(`${selectedLine}`, decoration);
        decorations.push(decoration);
      }
    }

    editor.setDecorations(this.decorationCollection, decorations);
  }

  private formatAnnotationText(annotation: SvnAnnotation): string {
    const maxLength = this.config.maxAnnotationLength;

    if (!annotation.author || annotation.author === 'Unknown') {
      return '';
    }

    const message = this.toSingleLine(annotation.message) || '无提交说明';
    const dateText = this.formatDate(annotation.date);
    let displayText = `${message} - ${annotation.author} - ${dateText}`;

    if (displayText.length > maxLength) {
      displayText = displayText.substring(0, maxLength - 3) + '...';
    }

    return displayText;
  }

  private createHoverMessage(annotation: SvnAnnotation, filePath: string): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    const message = annotation.message?.trim() || '无提交说明';
    const messageForHover = this.escapeMarkdown(message).replace(/\r?\n/g, '  \n');
    const revision = annotation.revision || 'N/A';
    const dateText = this.formatDate(annotation.date);
    md.appendMarkdown(`**提交说明：**  \n${messageForHover}  \n`);
    md.appendMarkdown(`**作者：** ${annotation.author}  \n`);
    md.appendMarkdown(`**日期：** ${dateText}  \n`);
    md.appendMarkdown(`**版本：** \`${revision}\`  \n`);
    md.appendMarkdown(`\n[查看变更](command:svnAnnotator.viewChanges?${encodeURIComponent(JSON.stringify({ filePath, revision }))})`);
    return md;
  }

  private formatDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) {
      return '未知';
    }
    return d.toLocaleDateString('zh-CN');
  }

  private toSingleLine(text?: string): string {
    if (!text) {
      return '';
    }
    return text.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private escapeMarkdown(text: string): string {
    return text.replace(/([\\`*_{}\[\]()#+\-!.])/g, '\\$1');
  }

  public async refresh(editor: vscode.TextEditor): Promise<void> {
    if (!editor || !editor.document) { return; }

    const filePath = editor.document.uri.fsPath;
    this.svnProvider.clearCacheForFile(filePath);
    this.currentDecorations.clear();
    await this.updateAnnotations(editor);
  }

  public async onSelectionChanged(editor: vscode.TextEditor): Promise<void> {
    if (!editor || !editor.document) {
      return;
    }
    const filePath = editor.document.uri.fsPath;
    this.selectedLineByFile.set(filePath, editor.selection.active.line);
    await this.updateAnnotations(editor);
  }

  public onDocumentChanged(editor: vscode.TextEditor, event: vscode.TextDocumentChangeEvent): void {
    if (!editor || !editor.document) {
      return;
    }

    const filePath = editor.document.uri.fsPath;
    const currentSelectedLine = this.selectedLineByFile.get(filePath);

    if (currentSelectedLine === undefined) {
      return;
    }

    for (const change of event.contentChanges) {
      const startLine = change.range.start.line;

      if (currentSelectedLine >= startLine) {
        this.selectedLineByFile.delete(filePath);
        if (this.decorationCollection) {
          editor.setDecorations(this.decorationCollection, []);
        }
        this.currentDecorations.clear();
        return;
      }
    }
  }

  public dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    if (this.decorationCollection) {
      this.decorationCollection.dispose();
    }
    if (this.statusBarItem) {
      this.statusBarItem.dispose();
    }
  }
}
