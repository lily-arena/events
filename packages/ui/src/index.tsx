import type { ButtonHTMLAttributes, ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
export function Button({
  children,
  kind = "",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: string }) {
  return (
    <button className={`button ${kind} ${className}`} {...props}>
      {children}
    </button>
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className = "",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className={`dialog ${className}`}>
          <Dialog.Title>{title}</Dialog.Title>
          {description && (
            <Dialog.Description className="dialog-description">
              {description}
            </Dialog.Description>
          )}
          {children}
          <div className="dialog-footer">
            <Dialog.Close asChild>
              <Button>닫기</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export {TextField} from "./TextField";
export {SelectField} from "./SelectField";
