"use strict";

class WeaponPatcher {
    constructor(plugin) {
        // Store a reference to the main plugin to access its name and config
        this.plugin = plugin;
    }

    patchOnDelay(server) {
        let attempts = 0;
        const maxAttempts = 10;
        const patcherInterval = setInterval(() => {
            attempts++;
            const serverWeapons = server._weaponDefinitions;
            const fireGroupDefs = server._firegroupDefinitions;
            const fireModeDefs = server._firemodeDefinitions;

            if (serverWeapons && fireGroupDefs && fireModeDefs && Object.keys(serverWeapons).length > 100) {
                console.log(`[${this.plugin.name}] All definitions appear loaded after ${attempts * 2} seconds.`);
                clearInterval(patcherInterval);
                this.runPatchAndClearCache(server);
            } else if (attempts >= maxAttempts) {
                console.error(`[${this.plugin.name}] FATAL: A required definition object was not found after ${maxAttempts * 2} seconds. Aborting patch.`);
                clearInterval(patcherInterval);
            } else {
                console.log(`[${this.plugin.name}] Waiting for server to load all definitions... (Attempt ${attempts}/${maxAttempts})`);
            }
        }, 2000);
    }

    runPatchAndClearCache(server) {
        let patchCount = 0;
        try {
            const serverWeapons = server._weaponDefinitions;
            const fireGroupDefs = server._firegroupDefinitions;
            const fireModeDefs = server._firemodeDefinitions;

            if (!this.plugin.config || !this.plugin.config.weapon_overrides) return;

            for (const weaponId in this.plugin.config.weapon_overrides) {
                if (!serverWeapons.hasOwnProperty(weaponId)) continue;
                
                const fireGroups = serverWeapons[weaponId]?.DATA?.FIRE_GROUPS;
                if (!fireGroups || fireGroups.length === 0) continue;

                const fireGroupId = fireGroups[0].FIRE_GROUP_ID;
                if (!fireGroupId || !fireGroupDefs.hasOwnProperty(fireGroupId)) continue;

                const fireModes = fireGroupDefs[fireGroupId]?.DATA?.FIRE_MODES;
                if (!fireModes || fireModes.length < 2) continue;
                
                const aimedFireModeId = fireModes[fireModes.length - 1].FIRE_MODE_ID;
                if (!aimedFireModeId || !fireModeDefs.hasOwnProperty(aimedFireModeId)) continue;
                
                const fireModeObject = fireModeDefs[aimedFireModeId];
                const statsObject = fireModeObject?.DATA?.DATA;

                if (statsObject) {
                    const overrides = this.plugin.config.weapon_overrides[weaponId];
                    console.log(`[${this.plugin.name}] Applying surgical patch to aimed Fire Mode ${aimedFireModeId} for Weapon ${weaponId}...`);
                    for (const property in overrides) {
                        if (statsObject.hasOwnProperty(property)) {
                            const oldValue = statsObject[property];
                            if (oldValue !== overrides[property]) {
                                statsObject[property] = overrides[property];
                                console.log(`[${this.plugin.name}]   - SUCCESS: Set ${property} from ${oldValue} to ${overrides[property]}.`);
                                patchCount++;
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error(`[${this.plugin.name}] An error occurred during the patch cycle:`, e);
        }

        if (patchCount > 0) {
          console.log(`[${this.plugin.name}] Patching complete. Found and applied ${patchCount} change(s).`);
          
          if (server.weaponDefinitionsCache) {
              console.log(`[${this.plugin.name}] Destroying weaponDefinitionsCache to force rebuild...`);
              delete server.weaponDefinitionsCache;
          }
          if (server.initialDataStaticDtoCache) {
              console.log(`[${this.plugin.name}] Destroying initialDataStaticDtoCache to force client sync...`);
              delete server.initialDataStaticDtoCache;
          }

          console.log(`[${this.plugin.name}] Cache clearing complete. Changes should now be permanent.`);
        } else {
            console.log(`[${this.plugin.name}] Patching ran, but no changes were needed or no valid targets found in config.`);
        }
    }
}

// Make this class available to other files
module.exports = WeaponPatcher;