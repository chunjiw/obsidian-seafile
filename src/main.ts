import { Notice, Plugin } from 'obsidian';
import * as IgnoreParser from 'gitignore-parser';
import { DEFAULT_IGNORE, initConfig, PLUGIN_DIR } from './config';
import Server from './server';
import { DEFAULT_SETTINGS, SeafileSettings } from './settings';
import { SyncController } from './sync/controller';
import { ExplorerView } from './ui/explorer';
import { SeafileSettingTab } from './ui/setting_tab';
import { disableDebugConsole } from './utils';

export default class SeafilePlugin extends Plugin {
	settings: SeafileSettings;
	server: Server;
	sync: SyncController;
	explorerView: ExplorerView;

	async onload() {
		this.settings = await this.loadSettings();
		this.server = new Server(this.settings);
		initConfig(this.app, this.server);

		this.sync = new SyncController(this.app.vault.adapter, this.settings);
		this.explorerView = new ExplorerView(this, this.sync);

		this.registerEvent(this.app.vault.on("create", (file) => {
			if (this.sync.status.type !== "stop")
				this.sync.notifyChange("/" + file.path, "create");
		}));
		this.registerEvent(this.app.vault.on("delete", (file) => {
			if (this.sync.status.type !== "stop")

				this.sync.notifyChange("/" + file.path, "delete");
		}));
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
			if (this.sync.status.type !== "stop") {
				this.sync.notifyChange("/" + oldPath, "delete");
				this.sync.notifyChange("/" + file.path, "create");
			}
		}));
		this.registerEvent(this.app.vault.on("modify", (file) => {
			if (this.sync.status.type !== "stop")
				this.sync.notifyChange("/" + file.path, "modify");
		}));

		this.addSettingTab(new SeafileSettingTab(this.app, this));

		if (this.settings.devMode) {
			(window as any)['seafile'] = this; // for debug
			this.addRibbonIcon("dice", "Clear Vault", async () => {
				await this.clearVault();
			});
			this.addRibbonIcon("dice", "Start Sync", async () => {
				await this.sync.startSync();
			});

			this.addRibbonIcon("dice", "Stop Sync", async () => {
				await this.sync.stopSyncAsync();
			});
		}
		else {
			disableDebugConsole();
		}
		if (this.settings.enableSync && !this.checkSyncReady()) {
			this.settings.enableSync = false;
			this.saveSettings();
			new Notice("Set up the Seafile plugin before enabling sync.");
		}

		if (this.settings.enableSync) {
			this.enableSync();
		}
	}

	async disableSync() {
		if (this.sync.status.type === "stop") return;
		await this.sync.stopSyncAsync();
	}

	async enableSync() {
		if (this.sync.status.type !== "stop") return;
		await this.sync.init();
		this.sync.startSync();
	}

	checkSyncReady(): boolean {
		const settings = this.settings;
		if (settings.authToken && settings.repoId) {
			return true;
		}
		return false;
	}

	async clearVault() {
		const clearNotice = new Notice("Clearing vault, please wait...", 0);
		const waitForStopNotice = new Notice("Waiting for syncing to stop", 0);

		try {
			await this.sync.stopSyncAsync();
		}
		finally {
			waitForStopNotice.hide();
		}

		try {
			const ignore = IgnoreParser.compile(DEFAULT_IGNORE + "\n" + this.settings.ignore);

			const remove = async (path: string, isDir: boolean) => {
				if (ignore.denies(path)) return;

				if (!isDir) {
					await this.app.vault.adapter.remove(path);
					return;
				}

				let list = await this.app.vault.adapter.list(path);
				for (const path of list.files) {
					await remove(path, false);
				}
				for (const path of list.folders) {
					await remove(path, true);
				}

				list = await this.app.vault.adapter.list(path);
				if (list.files.length === 0 && list.folders.length === 0 && path !== "") {
					await this.app.vault.adapter.rmdir(path, true);
				}
			}

			await remove("", true);


			// Clear own plugin folder
			const list = await this.app.vault.adapter.list(PLUGIN_DIR);
			for (const path of list.files) {
				const basename = path.split("/").pop();
				if (basename === "main.js" || basename === "manifest.json" || basename === "styles.css" || basename === "data.json") continue;
				await this.app.vault.adapter.remove(path);
			}
			for (const path of list.folders) {
				await this.app.vault.adapter.rmdir(path, true);
			}

			new Notice("Vault cleared", 3000);
		}
		finally {
			clearNotice.hide();
		}
	}

	onunload() {
		if (this.sync)
			this.sync.stopSyncAsync();
	}


	async loadSettings() {
		const settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		return settings;
	}

	async saveSettings(settings: SeafileSettings = this.settings) {
		this.settings = settings;
		await this.saveData(settings);
	}

}