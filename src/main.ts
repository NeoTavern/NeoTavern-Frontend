import { createApp } from 'vue';
import pinia from './stores';
import App from './App.vue';
import { useAuthStore } from './stores/auth.store';
import { toast } from './composables/useToast';
import i18n from './i18n';
import type { StrictT } from './composables/useStrictI18n';

import './styles/main.scss';
import '@fortawesome/fontawesome-free/css/all.min.css';

async function initializeApp() {
  const app = createApp(App);
  app.use(pinia);
  app.use(i18n);

  // Dynamically import and initialize the extension API
  const { setMainAppInstance } = await import('./utils/extension-api');
  setMainAppInstance(app);

  // @ts-expect-error 'i18n.global' is of type 'unknown'
  const t = i18n.global.t as StrictT;

  // Fetch CSRF token before mounting
  try {
    const authStore = useAuthStore();
    await authStore.fetchToken();
  } catch (error) {
    toast.error(t('errors.csrfToken'), 'Error', {
      timeout: 0,
    });
    console.error('Initialization failed:', error);
    // Prevent the app from mounting on critical error
    return;
  }

  app.mount('#app');
}

initializeApp();
