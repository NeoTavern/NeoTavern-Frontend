import type { ExtensionAPI } from '../../../types';
import { manifest } from './manifest';
import NotebookPanel from './NotebookPanel.vue';
import type { NotebookSettings } from './types';

export { manifest };

export function activate(api: ExtensionAPI<NotebookSettings>) {
  const t = api.i18n.t;

  async function showPopup() {
    await api.ui.showPopup({
      title: t('extensionsBuiltin.notebook.title'),
      component: NotebookPanel,
      componentProps: {
        api: api,
      },
      wide: true,
      large: true,
      okButton: 'common.close',
    });
  }

  api.ui.registerNavBarItem('core.notebook', {
    title: t('extensionsBuiltin.notebook.title'),
    icon: 'fa-solid fa-book',
    onClick: () => {
      showPopup();
    },
  });

  return () => {
    api.ui.unregisterNavBarItem('core.notebook');
  };
}
