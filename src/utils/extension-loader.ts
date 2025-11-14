import { sanitizeSelector } from './dom';

export function loadScript(name: string, jsFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = `/extensions/${name}/${jsFile}`;
    const id = sanitizeSelector(`${name}-js`);
    if (document.getElementById(id)) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.id = id;
    script.type = 'module';
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = (err) => reject(err);
    document.body.appendChild(script);
  });
}

// TODO: Use it in extension unloading
export function unloadScript(name: string) {
  const id = sanitizeSelector(`${name}-js`);
  const script = document.getElementById(id);
  if (script) {
    script.remove();
  }
}

export function loadStyle(name: string, cssFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = `/extensions/${name}/${cssFile}`;
    const id = sanitizeSelector(`${name}-css`);
    if (document.getElementById(id)) {
      resolve();
      return;
    }
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = url;
    link.onload = () => resolve();
    link.onerror = (err) => reject(err);
    document.head.appendChild(link);
  });
}

// TODO: Use it in extension unloading
export function unloadStyle(name: string) {
  const id = sanitizeSelector(`${name}-css`);
  const link = document.getElementById(id);
  if (link) {
    link.remove();
  }
}
