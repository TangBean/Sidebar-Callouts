import { App, Editor, MarkdownView, TFile } from "obsidian";
import { getCalloutDeletion, type ParsedCallout } from "./callouts";

export function getFileView(app: App, file: TFile): MarkdownView | null {
	const active = app.workspace.getActiveViewOfType(MarkdownView);
	if (active?.file === file) return active;
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		if (leaf.view instanceof MarkdownView && leaf.view.file === file) return leaf.view;
	}
	return null;
}

export function getFileEditor(app: App, file: TFile): Editor | null {
	const active = app.workspace.getActiveViewOfType(MarkdownView);
	if (active?.file === file && active.getMode() === "source") return active.editor;

	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.file === file && view.getMode() === "source") {
			return view.editor;
		}
	}
	return null;
}

export async function deleteCallout(
	app: App,
	file: TFile,
	snapshot: string,
	callout: ParsedCallout,
): Promise<boolean> {
	const deletion = getCalloutDeletion(snapshot, callout);
	if (!deletion) return false;

	const editor = getFileEditor(app, file);
	if (editor) {
		if (editor.getValue() !== snapshot) return false;
		editor.replaceRange(
			deletion.text,
			editor.offsetToPos(deletion.from),
			editor.offsetToPos(deletion.to),
		);
		return true;
	}

	const view = getFileView(app, file);
	if (view) {
		if (view.getViewData() !== snapshot) return false;
		await view.save();
		if (view.file !== file || view.getViewData() !== snapshot) return false;
	}

	let deleted = false;
	await app.vault.process(file, (current) => {
		// A source editor may have opened while the vault operation was queued.
		if (current !== snapshot || getFileEditor(app, file)) return current;
		const readingView = getFileView(app, file);
		if (readingView && readingView.getViewData() !== snapshot) return current;
		deleted = true;
		return current.slice(0, deletion.from) + deletion.text + current.slice(deletion.to);
	});
	return deleted;
}
