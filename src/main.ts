import { createApp } from 'vue';
import App from './App.vue';
import type { StrictT } from './composables/useStrictI18n';
import { toast } from './composables/useToast';
import i18n from './i18n';
import pinia from './stores';
import { useAuthStore } from './stores/auth.store';
import { setMainAppInstance } from './utils/extensions';

import '@fortawesome/fontawesome-free/css/all.min.css';
import './styles/main.scss';

async function initializeApp() {
  const app = createApp(App);
  app.use(pinia);
  app.use(i18n);
  app.config.performance = true;

  setMainAppInstance(app);

  // @ts-expect-error 'i18n.global' is of type 'unknown'
  const t = i18n.global.t as StrictT;

  // Initialize Auth Store (CSRF + Login Check)
  try {
    const authStore = useAuthStore();
    await authStore.initialize();
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
