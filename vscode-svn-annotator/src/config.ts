import * as vscode from 'vscode';

export class Config {
  private static instance: Config;

  private constructor() {}

  public static getInstance(): Config {
    if (!Config.instance) {
      Config.instance = new Config();
    }
    return Config.instance;
  }

  public get maxAnnotationLength(): number {
    return vscode.workspace.getConfiguration('svnAnnotator').get<number>('maxAnnotationLength', 80);
  }

  public get cacheEnabled(): boolean {
    return vscode.workspace.getConfiguration('svnAnnotator').get<boolean>('cacheEnabled', true);
  }

  public get cacheTTL(): number {
    return vscode.workspace.getConfiguration('svnAnnotator').get<number>('cacheTTL', 300);
  }

  public get svnPath(): string {
    return vscode.workspace.getConfiguration('svnAnnotator').get<string>('svnPath', 'svn');
  }

  public get annotationFormat(): string {
    return vscode.workspace.getConfiguration('svnAnnotator').get<string>('annotationFormat', '{author} - {message}');
  }

  public get showDate(): boolean {
    return vscode.workspace.getConfiguration('svnAnnotator').get<boolean>('showDate', false);
  }

  public get maxCacheFiles(): number {
    return vscode.workspace.getConfiguration('svnAnnotator').get<number>('maxCacheFiles', 20);
  }

  public formatAnnotation(author: string, message: string, date?: Date): string {
    let formatted = this.annotationFormat
      .replace('{author}', author)
      .replace('{message}', this.truncateMessage(message));

    if (this.showDate && date) {
      formatted += ` (${this.formatDate(date)})`;
    }

    return formatted;
  }

  private truncateMessage(message: string): string {
    if (message.length > this.maxAnnotationLength) {
      return message.substring(0, this.maxAnnotationLength - 3) + '...';
    }
    return message;
  }

  private formatDate(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 30) {
      return date.toLocaleDateString();
    } else if (days > 0) {
      return `${days}d ago`;
    } else if (hours > 0) {
      return `${hours}h ago`;
    } else if (minutes > 0) {
      return `${minutes}m ago`;
    } else {
      return 'just now';
    }
  }
}
