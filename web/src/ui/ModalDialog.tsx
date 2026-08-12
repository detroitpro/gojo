import { useCallback, type ReactNode } from "react";
import Modal, {
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
} from "@atlaskit/modal-dialog";

export type ModalDialogProps = {
  open: boolean;
  title: string;
  wide?: boolean;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
};

export function ModalDialog({
  open,
  title,
  wide = false,
  onClose,
  children,
  footer,
}: ModalDialogProps) {
  const handleClose = useCallback(() => onClose(), [onClose]);

  return (
    <ModalTransition>
      {open ? (
        <Modal onClose={handleClose} width={wide ? "large" : "medium"} shouldScrollInViewport>
          <ModalHeader>
            <ModalTitle>{title}</ModalTitle>
          </ModalHeader>
          <ModalBody>{children}</ModalBody>
          {footer ? <ModalFooter>{footer}</ModalFooter> : null}
        </Modal>
      ) : null}
    </ModalTransition>
  );
}
