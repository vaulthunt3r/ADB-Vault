import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { defaultWebServices, restoreWebServices, validateWebService, type WebService } from '../../electron/web-services'
interface WebServicesState {
  services: WebService[]; query: 'package' | 'name'
  save: (service: WebService) => void; toggle: (id: string) => void; remove: (id: string) => void; reset: (id: string) => void
  move: (id: string, direction: -1 | 1) => void
  moveTo: (id: string, targetId: string) => void
}
export const useWebServicesStore = create<WebServicesState>()(persist(set => ({
  services: defaultWebServices.map(s => ({ ...s })), query: 'package',
  save: service => { const valid = validateWebService(service); set(s => { if (!s.services.some(x => x.id === valid.id) && s.services.length >= 100) throw new Error('At most 100 services are supported.'); return { services: s.services.some(x => x.id === valid.id) ? s.services.map(x => x.id === valid.id ? valid : x) : [...s.services, valid] } }) },
  toggle: id => set(s => ({ services: s.services.map(x => x.id === id ? { ...x, enabled: !x.enabled } : x) })),
  move: (id, direction) => set(s => {
    const index = s.services.findIndex(service => service.id === id)
    if (index < 0) return s
    let next = index + direction
    while (next >= 0 && next < s.services.length && s.services[next].kind !== s.services[index].kind) next += direction
    if (next < 0 || next >= s.services.length) return s
    const services = [...s.services]
    ;[services[index], services[next]] = [services[next], services[index]]
    return { services }
  }),
  moveTo: (id, targetId) => set(s => {
    const source = s.services.find(service => service.id === id), target = s.services.find(service => service.id === targetId)
    if (!source || !target || id === targetId || source.kind !== target.kind) return s
    const group = s.services.filter(service => service.kind === source.kind)
    const from = group.findIndex(service => service.id === id), to = group.findIndex(service => service.id === targetId)
    group.splice(from, 1); group.splice(to, 0, source)
    let index = 0
    return { services: s.services.map(service => service.kind === source.kind ? group[index++] : service) }
  }),
  remove: id => { if (!defaultWebServices.some(s => s.id === id)) set(s => ({ services: s.services.filter(x => x.id !== id) })) },
  reset: id => { const original = defaultWebServices.find(s => s.id === id); if (original) set(s => ({ services: s.services.map(x => x.id === id ? { ...original } : x) })) },
}), { name: 'adb-vault-web-services', version: 1, partialize: s => ({ services: s.services, query: s.query }), merge: (saved, current) => { const data = saved as Partial<WebServicesState> | undefined; return { ...current, services: restoreWebServices(data?.services), query: data?.query === 'name' ? 'name' : 'package' } } }))
