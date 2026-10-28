/** Hands a file to the browser's download (the "save file" of the web app: image and zip exports). */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // the download has started by the next task; revoking earlier can cancel it
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
