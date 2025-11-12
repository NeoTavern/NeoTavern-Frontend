import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { useAuthStore } from './stores/auth.store';
import { toast } from './composables/useToast';
import * as Vue from 'vue';

import './styles/main.scss';
import '@fortawesome/fontawesome-free/css/all.min.css';

// Expose Vue for extensions that might need to mount their own components
(window as any).Vue = Vue;

async function initializeApp() {
  const app = createApp(App);
  const pinia = createPinia();
  app.use(pinia);

  // Fetch CSRF token before mounting
  try {
    const authStore = useAuthStore();
    await authStore.fetchToken();
  } catch (error) {
    toast.error("Couldn't get CSRF token. Please refresh the page.", 'Error', {
      timeout: 0,
    });
    console.error('Initialization failed:', error);
    // Prevent the app from mounting on critical error
    return;
  }

  app.mount('#app');
}

initializeApp();
