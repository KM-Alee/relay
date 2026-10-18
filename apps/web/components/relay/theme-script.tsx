// Sets data-theme on <html> before first paint so there is no light/dark flash (Q17). Server component.
// The script is a constant string with no user data, which is why dangerouslySetInnerHTML is acceptable
// here (React would HTML-escape quotes in a text child and break the script).
export const THEME_STORAGE_KEY = 'relay-theme';

const SCRIPT = `(function(){try{var k='${THEME_STORAGE_KEY}';var t=localStorage.getItem(k)||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){}})();`;

export function ThemeScript() {
  // eslint-disable-next-line no-restricted-syntax -- constant script, see header comment
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
