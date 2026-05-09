import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { idbStorage, idbBlobPut, idbBlobGet, idbBlobDelete } from './idbStorage';
import type { Template } from '../types/template';

function blobKey(templateId: string): string {
  return `template:${templateId}:imscc`;
}

interface TemplateState {
  templates: Template[];
  /** Currently selected template id, surfaced by Setup once we wire it up. */
  activeTemplateId: string | null;

  addTemplate: (template: Template, blob: Blob) => Promise<void>;
  removeTemplate: (id: string) => Promise<void>;
  setActiveTemplate: (id: string | null) => void;
  /** Read the raw .imscc Blob for a template id, for export-time re-use. */
  getTemplateBlob: (id: string) => Promise<Blob | null>;
}

export const useTemplateStore = create<TemplateState>()(
  persist(
    (set) => ({
      templates: [],
      activeTemplateId: null,

      addTemplate: async (template, blob) => {
        await idbBlobPut(blobKey(template.id), blob);
        set((state) => ({
          templates: [...state.templates.filter((t) => t.id !== template.id), template],
          activeTemplateId: template.id,
        }));
      },

      removeTemplate: async (id) => {
        await idbBlobDelete(blobKey(id));
        set((state) => ({
          templates: state.templates.filter((t) => t.id !== id),
          activeTemplateId: state.activeTemplateId === id ? null : state.activeTemplateId,
        }));
      },

      setActiveTemplate: (id) => set({ activeTemplateId: id }),

      getTemplateBlob: (id) => idbBlobGet(blobKey(id)),
    }),
    {
      name: 'classbuild-templates',
      storage: idbStorage,
      partialize: (state) => ({
        templates: state.templates,
        activeTemplateId: state.activeTemplateId,
      }),
    },
  ),
);
