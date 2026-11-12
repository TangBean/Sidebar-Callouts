import { Component, ItemView, Menu, WorkspaceLeaf, setIcon } from "obsidian";
import type CalloutNavigatorPlugin from "../main";

export const VIEW_TYPE_CALLOUT_NAVIGATOR = "callout-navigator-view";

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

export class CalloutNavigatorView extends ItemView {
	plugin: CalloutNavigatorPlugin;
	private refreshVersion = 0;
	private renderComponent: Component | null = null;
	private contextMenu: Menu | null = null;

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
		this.register(() => this.contextMenu?.hide());
		this.contentEl.addClass("callout-nav");
		await this.refresh();
	}

	async onClose() {
		this.refreshVersion++;
		this.contextMenu?.hide();
		if (this.renderComponent) this.removeChild(this.renderComponent);
		this.renderComponent = null;
		this.contentEl.empty();
	}

	async refresh() {
		const version = ++this.refreshVersion;
		const activeFile = this.app.workspace.getActiveFile();
		const { file, markdown, callouts } = await this.plugin.getCurrentState();
		if (version !== this.refreshVersion || activeFile !== this.app.workspace.getActiveFile()) return;
		if (this.renderComponent) this.removeChild(this.renderComponent);
		const events = this.renderComponent = this.addChild(new Component());
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

			events.registerDomEvent(item, "click", activate);
			events.registerDomEvent(item, "contextmenu", (evt: MouseEvent) => {
				evt.preventDefault();
				evt.stopPropagation();
				this.contextMenu?.hide();
				const menu = this.contextMenu = new Menu();
				menu.addItem((entry) => entry
					.setTitle("Delete")
					.setIcon("trash-2")
					.setWarning(true)
					.onClick(() => this.plugin.deleteCallout(file, markdown, callout)));
				menu.onHide(() => {
					if (this.contextMenu === menu) this.contextMenu = null;
				});
				menu.showAtMouseEvent(evt);
			});
			events.registerDomEvent(item, "keydown", (evt: KeyboardEvent) => {
				if (evt.key === "Enter" || evt.key === " ") {
					evt.preventDefault();
					activate();
				}
			});
		}
	}
}
