import axios from "axios";
import * as E from "fp-ts/lib/Either";
import { Lazy, pipe } from "fp-ts/lib/function";
import * as O from "fp-ts/lib/Option";
import * as RA from "fp-ts/lib/ReadonlyArray";
import * as Str from "fp-ts/lib/string";
import * as TE from "fp-ts/lib/TaskEither";
import {
	App,
	FileSystemAdapter,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TAbstractFile,
	TFile,
	Vault,
} from "obsidian";

interface Settings {
	url: string;
	apiKey: string;
	apiSecret: string;
}

const DEFAULT_SETTINGS: Settings = {
	url: "",
	apiKey: "",
	apiSecret: "",
};

const PUBLISHED_DIR = "published";

export default class MyPlugin extends Plugin {
	settings: Settings;

	async onload() {
		await this.loadSettings();

		const adapter = this.app.vault.adapter as FileSystemAdapter;
		const basePath = adapter.getBasePath();

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!("extension" in file)) {
					return;
				}

				const { url, apiKey, apiSecret } = this.settings;
				const token = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");

				menu.addItem((item) => {
					item
						.setTitle("Publish file")
						.setIcon("document")
						.onClick(() =>
							pipe(
								file,
								log("Publishing file..."),
								TE.fromNullable(new Error("File not found")),
								TE.chain(publishFile(this.app.vault, url, token)),
								TE.chain(moveFile(this.app.vault)),
								TE.match(
									(e) => notify(e, "File failed to publish"),
									() => notify(undefined, "File has been published")
								)
							)()
						);
				});
			})
		);

		this.addSettingTab(new BlogPublisherTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

const TEthunk = <A>(f: Lazy<Promise<A>>) => TE.tryCatch(f, E.toError);

const publishFile =
	(vault: Vault, url: string, token: string) => (file: TFile) =>
		pipe(
			TE.right({ fileName: file.name }),
			TE.bind("file", () => TEthunk(() => vault.read(file))),
			TE.chain((data) =>
				TEthunk(() =>
					axios.post(url, data, {
						headers: {
							"Content-Type": "multipart/form-data",
							Authorization: "Basic " + token,
						},
					})
				)
			),
			TE.chain(() => TE.right(file))
		);

const log =
	(msg: string) =>
	<A>(a: A) => {
		console.log(msg);
		return a;
	};

const moveFile = (vault: Vault) => (file: TAbstractFile) =>
	file.path.contains(PUBLISHED_DIR)
		? TE.right(file)
		: pipe(
				file.path,
				Str.split("/"),
				(parts) => O.some(parts),
				O.chain((parts) =>
					pipe(parts, RA.insertAt(parts.length - 1, PUBLISHED_DIR))
				),
				TE.fromOption(() => new Error("unable to build file path")),
				TE.bindTo("parts"),
				TE.let("base", ({ parts }) => parts.slice(0, -1).join("/")),
				TE.let("path", ({ parts }) => parts.join("/")),
				TE.bind("created", ({ base }) =>
					pipe(
						pipe(
							TEthunk(() => vault.createFolder(base)),
							TE.match(
								() => base,
								() => base
							)
						),
						TE.fromTask
					)
				),
				TE.chain(({ path }) => TEthunk(() => vault.rename(file, path))),
				TE.chain(() => TE.right(file))
		  );

const notify = (e: Error | undefined, msg: string) => {
	console.log(msg);

	if (e) {
		console.error(e);
	}

	new Notice(msg);
};

class BlogPublisherTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h3", { text: "Blog Publisher Settings" });

		new Setting(containerEl)
			.setName("Publisher url")
			.setDesc(
				"This should be a POST url where the file is sent as a multipart/form-data body to."
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter the url")
					.setValue(this.plugin.settings.url)
					.onChange(async (value) => {
						this.plugin.settings.url = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("API Key")
			.setDesc(
				"API Key used when posting a blog to the URL. NOTE: this is passed as the user of the basic authorization header."
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter your key")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("API Secret")
			.setDesc(
				"API Secret used when posting a blog to the URL. NOTE: this is passed as the password of the basic authorization header."
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter your secret")
					.setValue(this.plugin.settings.apiSecret)
					.onChange(async (value) => {
						this.plugin.settings.apiSecret = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
