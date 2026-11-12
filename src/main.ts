import { MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf, debounce } from "obsidian";
import { parseCallouts, type ParsedCallout } from "./callouts";
import { deleteCallout, getFileEditor, getFileView } from "./delete-callout";
import { CalloutNavigatorView, VIEW_TYPE_CALLOUT_NAVIGATOR } from "./ui/callout-view";

export default class CalloutNavigatorPlugin extends Plugin {
	requestRefresh = debounce(() => void this.refreshAllViews(), 100, true);

	async onload() {
		this.registerView(
			VIEW_TYPE_CALLOUT_NAVIGATOR,
			(leaf) => new CalloutNavigatorView(leaf, this)
		);

		this.addRibbonIcon("message-square-warning", "Open Sidebar Callouts", async () => {
			await this.activateView();
		});

		this.addCommand({
			id: "open-sidebar-callouts",
			name: "Open Sidebar Callouts",
			callback: async () => {
				await this.activateView();
			},
		});

		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.requestRefresh()));
		this.registerEvent(this.app.workspace.on("file-open", () => this.requestRefresh()));
		this.registerEvent(this.app.workspace.on("editor-change", () => this.requestRefresh()));

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				const tracked = this.getTrackedFile();
				if (tracked && file.path === tracked.path) {
					this.requestRefresh();
				}
			})
		);

		this.app.workspace.onLayoutReady(() => this.requestRefresh());
	}

	private getTrackedView(): MarkdownView | null {
		// 焦点在编辑器时，直接拿 active view。
		const active = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (active) return active;

		// 焦点在侧栏时，active view 不是 MarkdownView；
		// 改用 active file 反查承载该文件的 MarkdownView leaf，这样点击侧栏仍能找到正确目标。
		const file = this.app.workspace.getActiveFile();
		if (!file) return null;

		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === file.path) {
				return view;
			}
		}
		return null;
	}

	private getTrackedFile(): TFile | null {
		const file = this.app.workspace.getActiveFile();
		return file && file.extension === "md" ? file : null;
	}

	async getCurrentState(): Promise<{ file: TFile | null; markdown: string; callouts: ParsedCallout[] }> {
		const file = this.getTrackedFile();
		if (!file) {
			return { file: null, markdown: "", callouts: [] };
		}

		const editor = getFileEditor(this.app, file);
		const view = getFileView(this.app, file);
		const markdown = editor ? editor.getValue()
			: view ? view.getViewData() : await this.app.vault.cachedRead(file);

		return { file, markdown, callouts: parseCallouts(markdown) };
	}

	async deleteCallout(file: TFile, markdown: string, callout: ParsedCallout) {
		try {
			if (!(await deleteCallout(this.app, file, markdown, callout))) {
				new Notice("The note changed. Select the callout again to delete it.");
			}
		} catch {
			new Notice("Could not delete the callout. Try again.");
		} finally {
			await this.refreshAllViews();
		}
	}

	async refreshAllViews() {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CALLOUT_NAVIGATOR);
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof CalloutNavigatorView) {
				await view.refresh();
			}
		}
	}

	async activateView() {
		let leaf: WorkspaceLeaf | null =
			this.app.workspace.getLeavesOfType(VIEW_TYPE_CALLOUT_NAVIGATOR)[0] ?? null;

		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({
					type: VIEW_TYPE_CALLOUT_NAVIGATOR,
					active: true,
				});
			}
		}

		if (!leaf) return;

		await this.app.workspace.revealLeaf(leaf);

		if (leaf.view instanceof CalloutNavigatorView) {
			await leaf.view.refresh();
		}
	}

	async jumpToCallout(callout: ParsedCallout) {
		const view = this.getTrackedView();
		if (!view) return;

		// currentMode 是当前可见子视图（编辑态/阅读态都实现 applyScroll），
		// applyScroll(line) 统一把目标行滚到视口顶部，且不移动光标、不抢焦点。
		view.currentMode.applyScroll(callout.line);
	}
}
