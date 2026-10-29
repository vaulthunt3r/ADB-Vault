import { message as translateMessage } from "../lib/i18n"
import { t } from "../lib/i18n"
import { useState } from 'react'
import { categoryScope, defaultCategoryOptions, fileCategories, serviceFolderGroups, type FileCategory, type ServiceFolderGroup } from '../../electron/file-categories'
import type { FileLocation } from '../../electron/files-protocol'
import { currentTab, filesRequest, storageKey, useFilesStore } from '../store/useFilesStore'
import { categorySettingsKey, useFileCategorySettings } from '../store/useFileCategorySettings'
import { useConnectionStore } from '../store/useConnectionStore'

const categories = Object.keys(fileCategories) as FileCategory[]
export function FileCategorySettings() {
  const settings = useFileCategorySettings(), files = useFilesStore(), devices = useConnectionStore(s => s.devices)
  const [category, setCategory] = useState<FileCategory>('images'), [chosen, setChosen] = useState<string>()
  const [extra, setExtra] = useState<FileLocation>(), [error, setError] = useState('')
  const locations = new Map<string, FileLocation>()
  for (const side of [files.active, files.active === 'left' ? 'right' : 'left'] as const) {
    const tab = currentTab(files.panes[side]), l = tab.categoryScope || categoryScope(tab.location, files.storages[storageKey(tab.location)]?.entries)
    if (l.path) locations.set(categorySettingsKey(l), l)
  }
  for (const { location } of Object.values(settings.scopes)) if (!locations.has(categorySettingsKey(location))) locations.set(categorySettingsKey(location), location)
  if (extra) locations.set(categorySettingsKey(extra), extra)
  const key = chosen && locations.has(chosen) ? chosen : locations.keys().next().value
  const location = key ? locations.get(key) : undefined, options = settings.options[category] || defaultCategoryOptions
  async function chooseFolder() {
    try { const r = await filesRequest({ type: 'files.chooseFolder' }); if (r.folder) { const l: FileLocation = { kind: 'local', path: r.folder }; setExtra(l); setChosen(categorySettingsKey(l)); setError('') } }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const label = (l: FileLocation) => `${l.kind === 'local' ? t("This PC / SMB") : devices.find(d => d.hardwareId && d.hardwareId === l.hardwareId || d.id === l.id)?.name || l.serial || t("Phone")} · ${l.path}`
  return <section className="section-content fm-category-settings" aria-labelledby="file-category-settings-title">
    <div className="section-heading"><div><div className="eyebrow section-eyebrow">{t("SETTINGS / FILES")}</div><h1 id="file-category-settings-title">{t("Categories")}</h1><p>{t("Choose what appears in Places and where each category searches.")}</p></div></div>
    <fieldset className="fm-visible-categories"><legend>{t("Show in Places")}</legend>{categories.map(c => <label key={c}><input type="checkbox" checked={settings.options[c]?.visible !== false} onChange={e => settings.change(c, { visible: e.target.checked })} />{t(fileCategories[c].label)}</label>)}</fieldset>
    <label className="fm-setting-field">{t("Category")}<select value={category} onChange={e => setCategory(e.target.value as FileCategory)}>{categories.map(c => <option key={c} value={c}>{t(fileCategories[c].label)}</option>)}</select></label>
    <fieldset className="apps-loading-settings"><legend>{t("Include in ")}{t(fileCategories[category].label)}</legend>
      {category === 'images' && <label><input type="checkbox" checked={options.iconFiles} onChange={e => settings.change(category, { iconFiles: e.target.checked })} /><span><strong>{t("Icon files")}</strong><small>{t("ICO, CUR and ICNS. PNG/SVG images elsewhere keep their normal classification.")}</small></span></label>}
      {(Object.keys(serviceFolderGroups) as ServiceFolderGroup[]).map(group => <label key={group}><input type="checkbox" checked={options.serviceFolders.includes(group)} onChange={e => settings.change(category, { serviceFolders: e.target.checked ? [...options.serviceFolders, group] : options.serviceFolders.filter(g => g !== group) })} /><span><strong>{t(serviceFolderGroups[group].label)}</strong><small>{serviceFolderGroups[group].names.join(', ')}{t(" — including their contents, anywhere inside the search location.")}</small></span></label>)}
    </fieldset>
    <div className="fm-setting-location"><label className="fm-setting-field">{t("Search location")}<select aria-label={t("Category search location")} value={key || ''} onChange={e => setChosen(e.target.value)}>{!locations.size && <option value="">{t("Open a folder in Files first")}</option>}{[...locations].map(([k, l]) => <option key={k} value={k}>{label(l)}</option>)}</select></label><button className="button secondary" onClick={() => void chooseFolder()}>{t("Choose PC folder…")}</button></div>
    {error && <p role="alert">{translateMessage(error)}</p>}
    {location && <FolderRuleEditor key={key + category} location={location} category={category} />}
    <p className="apps-settings-note">{t("Results are kept for this session. Use Refresh in Files after changing these settings or files. A different connection or restarting ADB Vault requires a new scan.")}</p>
  </section>
}

function FolderRuleEditor({ location, category }: { location: FileLocation; category: FileCategory }) {
  const store = useFileCategorySettings(), rules = store.scopes[categorySettingsKey(location)]?.rules[category]
  const [include, setInclude] = useState(rules?.include.join('\n') || ''), [exclude, setExclude] = useState(rules?.exclude.join('\n') || '')
  const [message, setMessage] = useState(''), [error, setError] = useState('')
  const lines = (s: string) => s.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  function save() {
    try { store.folders(location, category, { include: lines(include), exclude: lines(exclude) }); setError(''); setMessage("Folders saved. Refresh the category to apply."); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setMessage('') }
  }
  return <div className="fm-folder-rules">
    <p>{t("Paths are relative to ")}<code>{location.path}</code>{t(", one per line. Subfolders are included. Exclusions take priority.")}</p>
    <div className="fm-rule-columns">
      <label className="fm-setting-field">{t("Search only these folders")}<textarea aria-label={t("Search only these folders")} rows={5} placeholder={t("DCIM\nPictures")} value={include} onChange={e => { setInclude(e.target.value); setMessage('') }} /><small>{t("Empty: search the entire location.")}</small></label>
      <label className="fm-setting-field">{t("Skip these folders")}<textarea aria-label={t("Skip these folders")} rows={5} placeholder={t("DCIM/Private\nDownload/Temporary")} value={exclude} onChange={e => { setExclude(e.target.value); setMessage('') }} /><small>{t("Skipped folders are not scanned.")}</small></label>
    </div>
    <button className="button secondary" onClick={save}>{t("Save folders")}</button>{error && <p role="alert">{translateMessage(error)}</p>}{message && <p role="status">{translateMessage(message)}</p>}
  </div>
}
