import {
	ItemView,
	MarkdownView,
	Plugin,
	TFile,
	WorkspaceLeaf,
	debounce,
	setIcon,
} from "obsidian";

const VIEW_TYPE_CALLOUT_NAVIGATOR = "callout-navigator-view";

type FoldState = "" | "+" | "-";

interface ParsedCallout {
	line: number;
	rawType: string;
	canonicalType: string;
	title: string;
	foldState: FoldState;
}

const TYPE_ALIASES: Record<string, string> = {
	note: "note",

	abstract: "abstract",
	summary: "abstract",
	tldr: "abstract",

	info: "info",
	todo: "todo",

	tip: "tip",
	hint: "tip",
	important: "tip",

	success: "success",
	check: "success",
	done: "success",

	question: "question",
	help: "question",
	faq: "question",

	warning: "warning",
	caution: "warning",
	attention: "warning",

	failure: "failure",
	fail: "failure",
	missing: "failure",

	danger: "danger",
	error: "danger",

	bug: "bug",
	example: "example",

	quote: "quote",
	cite: "quote",

	comment: "comment",
};

const TYPE_ICONS: Record<string, string> = {
	note: "sticky-note",
	abstract: "file-text",
	info: "info",
	todo: "check-square",
	tip: "lightbulb",
	success: "check-circle",
	question: "help-circle",
	warning: "alert-triangle",
	failure: "x-circle",
	danger: "zap",
	bug: "bug",
	example: "flask-conical",
	quote: "quote",
	comment: "message-square-text",
};

function normalizeCalloutType(rawType: string): string {
	const lower = rawType.trim().toLowerCase();
	return TYPE_ALIASES[lower] ?? lower;
}

function prettifyType(type: string): string {
	return type
		.replace(/[-_]+/g, " ")
		.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function parseCallouts(markdown: string): ParsedCallout[] {
	const lines = markdown.split(/\r?\n/);
	const result: ParsedCallout[] = [];

	const calloutStartRegex = /^\s{0,3}>\s*\[!([A-Za-z0-9_-]+)\]([+-])?\s*(.*)$/;
	const calloutContinuationRegex = /^\s{0,3}>\s?(.*)$/;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		const match = line.match(calloutStartRegex);
		if (!match) continue;

		const rawTypeRaw = match[1];
		if (rawTypeRaw === undefined) continue;
		const rawType = rawTypeRaw.trim();
		const canonicalType = normalizeCalloutType(rawType);
		const rawFold = match[2];
		const foldState: FoldState = rawFold === "+" || rawFold === "-" ? rawFold : "";
		const rawTitle = match[3]?.trim() ?? "";

		let firstContentLine = "";
		if (rawTitle.length === 0) {
			for (let j = i + 1; j < lines.length; j++) {
				const next = lines[j];
				if (next === undefined) break;
				const cont = next.match(calloutContinuationRegex);
				if (!cont) break;
				const text = (cont[1] ?? "").trim();
				if (text.length > 0) {
					firstContentLine = text;
					break;
				}
			}
		}

		const title =
			rawTitle.length > 0
				? rawTitle
				: firstContentLine.length > 0
					? firstContentLine
					: prettifyType(rawType);

		result.push({
			line: i,
			rawType,
			canonicalType,
			title,
			foldState,
		});
	}

	return result;
}

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

	async getCurrentState(): Promise<{ file: TFile | null; callouts: ParsedCallout[] }> {
		const file = this.getTrackedFile();
		if (!file) {
			return { file: null, callouts: [] };
		}

		const view = this.getTrackedView();
		const markdown =
			view?.file?.path === file.path && view.editor
				? view.editor.getValue()
				: await this.app.vault.cachedRead(file);

		return { file, callouts: parseCallouts(markdown) };
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

		this.app.workspace.revealLeaf(leaf);

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

class CalloutNavigatorView extends ItemView {
	plugin: CalloutNavigatorPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: CalloutNavigatorPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_CALLOUT_NAVIGATOR;
	}

	getDisplayText(): string {
		return "Sidebar Callouts";
	}

	getIcon(): string {
		return "message-square-warning";
	}

	async onOpen() {
		this.contentEl.addClass("callout-nav");
		await this.refresh();
	}

	async onClose() {
		this.contentEl.empty();
	}

	async refresh() {
		const { file, callouts } = await this.plugin.getCurrentState();
		const container = this.contentEl;
		container.empty();
		container.addClass("callout-nav");

		const header = container.createDiv({ cls: "callout-nav__header" });
		header.createDiv({
			text: "Sidebar Callouts",
			cls: "callout-nav__header-title",
		});

		if (!file) {
			const empty = container.createDiv({ cls: "callout-nav__empty" });
			empty.setText("No active Markdown note.");
			return;
		}

		header.createDiv({
			text: `${callouts.length} callout${callouts.length === 1 ? "" : "s"}`,
			cls: "callout-nav__count",
		});

		if (callouts.length === 0) {
			const empty = container.createDiv({ cls: "callout-nav__empty" });
			empty.setText("This note has no callouts.");
			return;
		}

		const list = container.createDiv({ cls: "callout-nav__list" });

		for (const callout of callouts) {
			const item = list.createDiv({ cls: "callout-nav__item" });
			item.dataset.calloutType = callout.canonicalType;
			item.setAttr("role", "button");
			item.setAttr("tabindex", "0");
			item.setAttr(
				"aria-label",
				`Jump to ${callout.title} at line ${callout.line + 1}`
			);

			const iconWrap = item.createDiv({ cls: "callout-nav__icon" });
			setIcon(iconWrap, TYPE_ICONS[callout.canonicalType] ?? "message-square");

			const body = item.createDiv({ cls: "callout-nav__body" });

			const titleRow = body.createDiv({ cls: "callout-nav__title-row" });
			titleRow.createSpan({
				text: callout.title,
				cls: "callout-nav__title",
			});

			if (callout.foldState) {
				titleRow.createSpan({
					text: callout.foldState === "-" ? "collapsed" : "expanded",
					cls: "callout-nav__fold-state",
				});
			}

			const metaRow = body.createDiv({ cls: "callout-nav__meta-row" });
			metaRow.createSpan({
				text: callout.rawType,
				cls: "callout-nav__type",
			});
			metaRow.createSpan({
				text: `Line ${callout.line + 1}`,
				cls: "callout-nav__line",
			});

			const activate = () => {
				void this.plugin.jumpToCallout(callout);
			};

			item.addEventListener("click", activate);
			item.addEventListener("keydown", (evt: KeyboardEvent) => {
				if (evt.key === "Enter" || evt.key === " ") {
					evt.preventDefault();
					activate();
				}
			});
		}
	}
}
