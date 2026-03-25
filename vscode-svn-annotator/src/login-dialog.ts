import * as vscode from 'vscode';
import { SvnProvider } from './svn-provider';

export class LoginDialog {
  private static instance: LoginDialog;
  private svnProvider: SvnProvider;
  private secretStorage: vscode.SecretStorage | null = null;

  private constructor() {
    this.svnProvider = SvnProvider.getInstance();
  }

  public static getInstance(): LoginDialog {
    if (!LoginDialog.instance) {
      LoginDialog.instance = new LoginDialog();
    }
    return LoginDialog.instance;
  }

  public setSecretStorage(secretStorage: vscode.SecretStorage): void {
    this.secretStorage = secretStorage;
  }

  public async showLoginDialog(): Promise<void> {
    const username = await this.showUsernameInput();
    if (!username) {
      return;
    }

    const password = await this.showPasswordInput();
    if (!password) {
      return;
    }

    await this.performLogin(username, password, true);
  }

  private async showUsernameInput(): Promise<string | undefined> {
    const username = await vscode.window.showInputBox({
      prompt: 'Enter SVN username',
      placeHolder: 'Username',
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Username cannot be empty';
        }
        return null;
      }
    });
    return username;
  }

  private async showPasswordInput(): Promise<string | undefined> {
    const password = await vscode.window.showInputBox({
      prompt: 'Enter SVN password',
      placeHolder: 'Password',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value || value.length === 0) {
          return 'Password cannot be empty';
        }
        return null;
      }
    });
    return password;
  }

  public async performLogin(username: string, password: string, showMessage: boolean): Promise<boolean> {
    const result = await this.svnProvider.login(username, password);

    if (result.success) {
      if (this.secretStorage) {
        await this.secretStorage.store('svnAnnotator.username', username);
        await this.secretStorage.store('svnAnnotator.password', password);
      }
      if (showMessage) {
        vscode.window.showInformationMessage('SVN Login successful!', 'OK');
      }
      await vscode.commands.executeCommand('svnAnnotator.refresh');
      return true;
    } else {
      if (showMessage) {
        vscode.window.showErrorMessage(`SVN Login failed: ${result.error || 'Unknown error'}`, 'Retry').then(selection => {
          if (selection === 'Retry') {
            this.showLoginDialog();
          }
        });
      }
      return false;
    }
  }

  public showNotLoggedInMessage(): void {
    vscode.window.showWarningMessage(
      'SVN Annotator: You are not logged in. Annotations are disabled.',
      'Login Now',
      'Later'
    ).then(selection => {
      if (selection === 'Login Now') {
        this.showLoginDialog();
      }
    });
  }
}
