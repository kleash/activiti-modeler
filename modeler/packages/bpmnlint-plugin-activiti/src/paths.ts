export const basenameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
export const dirnameOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
