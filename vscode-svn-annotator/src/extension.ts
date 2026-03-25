import * as vscode from 'vscode';
import { Annotator } from './annotator';
import { LoginDialog } from './login-dialog';
import { ViewChangesCommand } from './hover-provider';
import { SvnProvider } from './svn-provider';

let annotator: Annotator;
let loginDialog: LoginDialog;
let viewChangesCommand: ViewChangesCommand;
let svnProvider: SvnProvider;

export function activate(context: vscode.ExtensionContext) {
  svnProvider = SvnProvider.getInstance();
  annotator = Annotator.getInstance();
  loginDialog = LoginDialog.getInstance();
  loginDialog.setSecretStorage(context.secrets);
  viewChangesCommand = ViewChangesCommand.getInstance();

  const disposableCommands: vscode.Disposable[] = [];

  disposableCommands.push(
    vscode.commands.registerCommand('svnAnnotator.login', () => {
      loginDialog.showLoginDialog();
    })
  );

  disposableCommands.push(
    vscode.commands.registerCommand('svnAnnotator.refresh', () => {
      if (!svnProvider.isLoggedIn()) {
        loginDialog.showLoginDialog();
        return;
      }
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        annotator.refresh(editor);
      } else {
        vscode.window.showInformationMessage('SVN Annotator: open a file to refresh annotations.');
      }
    })
  );

  disposableCommands.push(
    vscode.commands.registerCommand('svnAnnotator.disable', () => {
      annotator.disable();
    })
  );

  disposableCommands.push(
    vscode.commands.registerCommand('svnAnnotator.enable', () => {
      annotator.enable();
    })
  );

  disposableCommands.push(
    vscode.commands.registerCommand('svnAnnotator.viewChanges', (args) => {
      viewChangesCommand.execute(args);
    })
  );

  const activeEditorChangeHandler = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor) {
      annotator.updateAnnotations(editor);
    }
  });

  const documentChangeHandler = vscode.workspace.onDidChangeTextDocument((event) => {
    const editor = vscode.window.activeTextEditor;
    if (editor && event.document === editor.document) {
      annotator.updateAnnotations(editor);
    }
  });

  const documentCloseHandler = vscode.workspace.onDidCloseTextDocument((document) => {
    svnProvider.clearCacheForFile(document.uri.fsPath);
  });

  const selectionChangeHandler = vscode.window.onDidChangeTextEditorSelection((event) => {
    const editor = vscode.window.activeTextEditor;
    if (editor && event.textEditor === editor) {
      annotator.onSelectionChanged(editor);
    }
  });

  const configChangeHandler = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('svnAnnotator')) {
      svnProvider.clearCache();
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        annotator.refresh(editor);
      }
    }
  });

  if (vscode.window.activeTextEditor) {
    annotator.updateAnnotations(vscode.window.activeTextEditor);
  }

  void (async () => {
    const savedUsername = await context.secrets.get('svnAnnotator.username');
    const savedPassword = await context.secrets.get('svnAnnotator.password');
    if (savedUsername && savedPassword) {
      await loginDialog.performLogin(savedUsername, savedPassword, false);
    }
  })();

  context.subscriptions.push(
    ...disposableCommands,
    activeEditorChangeHandler,
    selectionChangeHandler,
    documentChangeHandler,
    documentCloseHandler,
    configChangeHandler,
    annotator
  );
}

export function deactivate() {
  if (annotator) {
    annotator.dispose();
  }
  if (svnProvider) {
    svnProvider.clearCache();
  }
}
