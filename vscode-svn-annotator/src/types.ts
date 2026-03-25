export interface SvnAnnotation {
  lineNumber: number;
  author: string;
  date: Date;
  message: string;
  revision: string;
  shortRevision: string;
}

export interface LoginResult {
  success: boolean;
  error?: string;
}

export interface SvnLoginInfo {
  username: string;
  password: string;
  isLoggedIn: boolean;
}

export interface CacheEntry {
  annotations: SvnAnnotation[];
  timestamp: number;
  filePath: string;
  fileModifiedTime: number;
}

export interface HoverInfo {
  annotation: SvnAnnotation;
  filePath: string;
}

export interface SvnBlameLine {
  revision: string;
  author: string;
  date: string;
  lineNumber: number;
  content: string;
}
