export function openDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
    return;
  }

  dialog.dataset.dialogFallback = "true";
  dialog.setAttribute("open", "");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  document.documentElement.classList.add("has-fallback-dialog");
}

export function closeDialog(dialog: HTMLDialogElement): void {
  const usedFallback = dialog.dataset.dialogFallback === "true";
  if (typeof dialog.close === "function") {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
    dialog.dispatchEvent(new Event("close"));
  }

  if (usedFallback) {
    delete dialog.dataset.dialogFallback;
    document.documentElement.classList.remove("has-fallback-dialog");
  }
}
