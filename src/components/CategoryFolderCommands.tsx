import { useState } from 'react'
import { appendCategoryFolders, categoryQuery, defaultCategoryOptions, fileCategories, relativeCategoryFolders, type FileCategory } from '../../electron/file-categories'
import { searchFolderPolicy } from '../../electron/file-search-folders'
import type { FileLocation } from '../../electron/files-protocol'
import { useAppStore } from '../store/useAppStore'
import { categorySettingsKey, useFileCategorySettings } from '../store/useFileCategorySettings'

export function CategoryFolderCommands({ scope, root, paths, category, disabled, done }: { scope: FileLocation; root: FileLocation; paths: string[]; category?: FileCategory; disabled: boolean; done: () => void }) {
  const [chosen, setChosen] = useState<FileCategory>('images')
  const current = category || chosen
  let reason = ''
  try { relativeCategoryFolders(root, paths) } catch (e) { reason = e instanceof Error ? e.message : String(e) }
  function add(target: 'include' | 'exclude') {
    try {
      const store = useFileCategorySettings.getState(), previous = store.scopes[categorySettingsKey(scope)]?.rules[current]
      const rules = appendCategoryFolders(root, previous, target, paths)
      store.folders(scope, current, rules)
      const policy = searchFolderPolicy(categoryQuery(current, store.options[current] || defaultCategoryOptions, rules), scope.kind === 'local')
      const blocked = target === 'include' && relativeCategoryFolders(root, paths).some(p => !policy.allowed(p, true))
      useAppStore.getState().notify(`${fileCategories[current].label}: ${paths.length} ${paths.length === 1 ? 'folder' : 'folders'} added to ${target === 'include' ? "Search only these folders" : "Skip these folders"}. ${blocked ? "Some are still excluded by folder rules or service-folder settings." : "Applies on the next scan."}`)
      done()
    } catch (e) { useAppStore.getState().notify(e instanceof Error ? e.message : String(e)) }
  }
  return <div className="fm-category-folder-commands" role="group" aria-label="Category folder rules">
    {category ? <strong>{fileCategories[category].label}</strong> : <label>Category<select aria-label="Folder rule category" value={chosen} onChange={e => setChosen(e.target.value as FileCategory)}>{(Object.keys(fileCategories) as FileCategory[]).map(c => <option key={c} value={c}>{fileCategories[c].label}</option>)}</select></label>}
    <small title={scope.path}>{"Search location: "}{scope.path}</small>
    <button disabled={disabled || !!reason} title={reason || "Add selected folders and their subfolders to this category’s search list."} onClick={() => add('include')}>Add to Search only these folders</button>
    <button disabled={disabled || !!reason} title={reason || "Skip selected folders and their subfolders on the next scan."} onClick={() => add('exclude')}>Add to Skip these folders</button>
  </div>
}
