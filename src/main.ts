import { RightMenu } from './components/RightMenu';
import { Toast } from './components/Toast';
import { token } from './stores/auth.store';
import './styles/main.scss';
import '@fortawesome/fontawesome-free/css/all.min.css';

Toast.options({
  positionClass: 'toast-top-center',
  closeButton: false,
  showDuration: 250,
  hideDuration: 250,
  timeOut: 4000,
  extendedTimeOut: 10000,
  escapeHtml: true,
});

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const tokenResponse = await fetch('/csrf-token');
    const tokenData = await tokenResponse.json();
    token.set(tokenData.token);
  } catch {
    Toast.error(`Couldn't get CSRF token. Please refresh the page.`, `Error`, {
      timeOut: 0,
      extendedTimeOut: 0,
      preventDuplicates: true,
    });
    throw new Error('Initialization failed');
  }

  const topBar = document.getElementById('top-settings-holder');
  if (!topBar) throw new Error('Top settings holder not found');

  topBar.querySelectorAll('.drawer-toggle').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      toggle.nextElementSibling?.classList.toggle('active');
      toggle.querySelector('.drawer-icon')?.classList.toggle('active');
    });
  });

  const rightMenu = new RightMenu();
  await rightMenu.init();
});
