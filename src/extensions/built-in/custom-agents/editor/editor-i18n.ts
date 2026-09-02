import { useI18n } from 'vue-i18n';

export function useEditorI18n() {
  const { t, te } = useI18n();
  const nodeCatalog = 'extensionsBuiltin.customAgents.nodes.';
  const catalog = 'extensionsBuiltin.customAgents.catalog';
  const translateKey = (key: string): string => {
    if (te(key))
      return key.startsWith(nodeCatalog)
        ? t(`extensionsBuiltin.customAgents.nodes.${key.slice(nodeCatalog.length)}`)
        : t(key);
    const catalogKey = key.replaceAll(/[^A-Za-z0-9_$]/g, '_');
    const commonKey = `${catalog}.${catalogKey}`;
    return te(commonKey) ? t(`extensionsBuiltin.customAgents.catalog.${catalogKey}`) : key;
  };
  return { t, translateKey };
}
