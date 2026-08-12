import { useCallback, useEffect, useState } from "react";
import { Check, FolderOpen, X } from "lucide-react";

import { AppButton } from "@/ui/AppButton";
import { ModalDialog } from "@/ui/ModalDialog";
import { browseFilesystem } from "@/contexts/operations/contract";
import type { BrowseRoot, DirectoryListing } from "@/contexts/operations/types";

export type DirectoryPickerProps = {
  open: boolean;
  initialPath?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
};

export function DirectoryPicker({ open, initialPath, onClose, onSelect }: DirectoryPickerProps) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [roots, setRoots] = useState<BrowseRoot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async (path?: string) => {
    setLoading(true);
    setError("");
    try {
      const result = await browseFilesystem(path);
      setListing(result.listing);
      setRoots(result.roots);
      setSelected(result.listing.isGitRepo ? result.listing.path : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to browse filesystem");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setSelected(null);
      void load(initialPath);
    }
  }, [open, initialPath, load]);

  function chooseCurrent() {
    if (!listing) return;
    onSelect(selected ?? listing.path);
  }

  return (
    <ModalDialog
      open={open}
      title="Choose repository"
      wide
      onClose={onClose}
      footer={
        <>
          <AppButton onClick={onClose} iconBefore={<X size={12} />}>
            Cancel
          </AppButton>
          <AppButton
            variant="primary"
            disabled={!listing}
            onClick={chooseCurrent}
            iconBefore={<Check size={12} />}
          >
            Use this folder
          </AppButton>
        </>
      }
    >
      <div className="picker-path mono mb-3">{listing?.path ?? "…"}</div>

      <div className="picker-roots">
        {roots.map((root) => (
          <AppButton
            key={root.path}
            size="sm"
            onClick={() => void load(root.path)}
            iconBefore={<FolderOpen size={12} />}
          >
            {root.label}
          </AppButton>
        ))}
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="picker-body">
        {listing?.parent ? (
          <button className="picker-row" type="button" onClick={() => void load(listing.parent!)}>
            <span className="picker-icon">↑</span>
            <span>.. parent</span>
          </button>
        ) : null}

        {loading ? (
          <div className="empty">Loading…</div>
        ) : listing ? (
          <>
            {listing.entries.map((entry) => (
              <button
                key={entry.path}
                className={`picker-row${selected === entry.path ? " selected" : ""}${entry.isGitRepo ? " git" : ""}`}
                type="button"
                onClick={() => setSelected(entry.path)}
                onDoubleClick={() => void load(entry.path)}
              >
                <span className="picker-icon">{entry.isGitRepo ? "●" : "▸"}</span>
                <span className="picker-name">{entry.name}</span>
                {entry.isGitRepo ? <span className="picker-badge">git</span> : null}
                <span
                  className="picker-open muted"
                  onClick={(e) => {
                    e.stopPropagation();
                    void load(entry.path);
                  }}
                >
                  Open
                </span>
              </button>
            ))}
            {listing.entries.length === 0 ? <div className="empty">No subdirectories</div> : null}
          </>
        ) : null}
      </div>

      <div className="muted mt-3">
        {selected ? (
          <>
            Selected: <span className="mono">{selected}</span>
          </>
        ) : listing?.isGitRepo ? (
          "Current folder is a git repo — you can select it"
        ) : (
          "Select a folder, or open into one (double-click)"
        )}
      </div>
    </ModalDialog>
  );
}
