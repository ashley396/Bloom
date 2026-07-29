import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { FloristryPhotoId } from "../../lib/floristry-photo-library";

type PagePhotoRegistryValue = {
  registerPhotoSlot: (photoId: FloristryPhotoId, slot: string) => void;
};

const PagePhotoRegistryContext = createContext<PagePhotoRegistryValue | null>(
  null,
);

export type PagePhotoRegistryProps = {
  pageId: string;
  children: ReactNode;
};

/**
 * Tracks catalog photo IDs used during a single page render tree.
 * Prevents duplicate assignments from slipping into production UI.
 */
export function PagePhotoRegistry({ pageId, children }: PagePhotoRegistryProps) {
  const usedIds = useRef(new Map<FloristryPhotoId, string>());

  const registerPhotoSlot = useCallback(
    (photoId: FloristryPhotoId, slot: string) => {
      const prior = usedIds.current.get(photoId);
      if (prior && prior !== slot) {
        console.error(
          `[Florisyn photography] Duplicate photo ID "${photoId}" on page "${pageId}": "${prior}" and "${slot}"`,
        );
        return;
      }
      usedIds.current.set(photoId, slot);
    },
    [pageId],
  );

  const value = useMemo(
    () => ({
      registerPhotoSlot,
    }),
    [registerPhotoSlot],
  );

  return (
    <PagePhotoRegistryContext.Provider value={value}>
      {children}
    </PagePhotoRegistryContext.Provider>
  );
}

export function usePagePhotoRegistry(): PagePhotoRegistryValue | null {
  return useContext(PagePhotoRegistryContext);
}
