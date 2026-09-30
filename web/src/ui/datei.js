// Dateien herunterladen, mit einem Namen, den jedes Betriebssystem mag.

export function dateiname(titel) {
  return (titel || 'Whiteboard').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Whiteboard';
}

export function herunterladen(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
