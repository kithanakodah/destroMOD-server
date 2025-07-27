// Simple auto-spawn system
"use strict";

const ZombieAI = require('./zombieAI.js');
const HumanAI = require('./humanAI.js');
const ArmorDamageSystem = require('./armorDamage.js');
// const WeaponDebugger = require('./weaponDebugger.js');
const HumanShoot = require('./humanShoot.js');

class DestroMOD_AI_Plugin {
  name = "destroMOD";
  commands = [
    {
      name: "debug_npc",
      permissionLevel: 0,
      execute: (server, client, args) => {
        if (!args[0]) {
          server.sendChatText(client, "Usage: /debug_npc <npcId>");
          return;
        }
        this.debugNPCEquipment(server, args[0]);
        server.sendChatText(client, `Debug info logged for NPC ${args[0]}`);
      }
    },
    {
      name: "list_npcs",
      permissionLevel: 0,
      execute: (server, client, args) => {
        const npcs = Object.keys(server._npcs);
        const humanNpcs = npcs.filter(id => server._npcs[id].isHumanNPC);
        server.sendChatText(client, `Total NPCs: ${npcs.length}, Human NPCs: ${humanNpcs.length}`);
        humanNpcs.forEach(id => {
          const npc = server._npcs[id];
          server.sendChatText(client, `  ${id}: Health ${npc.health}/${npc.maxHealth}`);
        });
      }
    },
    {
      name: "scan_npc_items",
      permissionLevel: 0,
      execute: (server, client, args) => {
        if (!args[0]) {
          server.sendChatText(client, "Usage: /scan_npc_items <npcId>");
          return;
        }
        
        const npc = server._npcs[args[0]];
        if (!npc || !npc.isHumanNPC) {
          server.sendChatText(client, `NPC ${args[0]} not found or not human`);
          return;
        }
        
        server.sendChatText(client, `=== NPC ${args[0]} Equipment Scan ===`);
        
        let totalItems = 0;
        
        // Scan equipment only (no loadout to avoid death bags)
        if (npc._equipment) {
          Object.keys(npc._equipment).forEach(slotId => {
            const item = npc._equipment[slotId];
            if (item) {
              server.sendChatText(client, `Equipment slot ${slotId}: ${item.modelName || 'Unknown'}`);
              totalItems++;
            }
          });
        }
        
        server.sendChatText(client, `Total equipment pieces: ${totalItems}`);
        server.sendChatText(client, `Loot bag will contain: AK-47, 7.62mm Ammo, Medical supplies`);
      }
    },
    {
      name: "debug_armor",
      permissionLevel: 0,
      execute: (server, client, args) => {
        if (!args[0]) {
          // Debug player's own armor
          server.debugArmorStatus(client.character);
          server.sendChatText(client, "Your armor status logged to console");
        } else {
          // Debug specific NPC's armor
          const npc = server._npcs[args[0]];
          if (npc) {
            server.debugArmorStatus(npc);
            server.sendChatText(client, `NPC ${args[0]} armor status logged to console`);
          } else {
            server.sendChatText(client, `NPC ${args[0]} not found`);
          }
        }
      }
    },
    {
      name: "spawn_npc",
      permissionLevel: 0,
      execute: (server, client, args) => {
        try {
          server.sendChatText(client, "Spawning new human NPC...");
          
          const success = this.spawnHumanNPC(server, client);
          
          if (success) {
            server.sendChatText(client, "✅ Successfully spawned new human NPC!");
            server.sendChatText(client, "Equipment will be applied automatically");
            
            // Auto-equip the new NPC after a short delay
            setTimeout(() => {
              this.equipAllHumanNPCs(server, client);
              server.sendChatText(client, "✅ Equipment applied to new NPC");
            }, 1000);
            
          } else {
            server.sendChatText(client, "❌ Failed to spawn new NPC - check server console");
          }
          
        } catch (error) {
          console.error(`[${this.name}] Error in spawn_npc command:`, error);
          server.sendChatText(client, "❌ Error spawning NPC - check server console");
        }
      }
    },
  ];

  attackCooldowns = new Map();
  shootCooldowns = new Map();
  config = {};
  lootBagCreated = new Set(); // Track NPCs that already had loot bags created

  // GAMEPLAY TUNING CONSTANTS (for zombies)
  ATTACK_COOLDOWN_MIN_MS = 1500;
  ATTACK_COOLDOWN_MAX_MS = 2500;
  AGGRO_RADIUS_MIN = 5.0;
  AGGRO_RADIUS_MAX = 10.0;
  ENRAGED_AGGRO_RADIUS = 75.0;
  ATTACK_RADIUS_MIN = 1.3;
  ATTACK_RADIUS_MAX = 1.8;
  MOVE_SPEED_MIN = 4.0;
  MOVE_SPEED_MAX = 12.0;
  MAX_VERTICAL_AGGRO_DISTANCE = 1.5;

  // --- ALERT MECHANIC ---
  ALERT_RADIUS = 5.0;
  ALERTED_AGGRO_RADIUS_MIN = 35.0;
  ALERTED_AGGRO_RADIUS_MAX = 45.0;

  // NEW: HUMAN NPC CONSTANTS
  SHOOT_RADIUS_MIN = 15.0;
  SHOOT_RADIUS_MAX = 25.0;
  ENRAGED_SHOOT_RADIUS = 50.0;
  ALERTED_SHOOT_RADIUS_MIN = 20.0;
  ALERTED_SHOOT_RADIUS_MAX = 30.0;
  SHOOT_COOLDOWN_MIN_MS = 2000;
  SHOOT_COOLDOWN_MAX_MS = 4000;

  constructor() {
    this.zombieAI = new ZombieAI(this);
    this.humanAI = new HumanAI(this);
    this.armorDamage = new ArmorDamageSystem(this);
    // this.weaponDebugger = new WeaponDebugger(this); // ADD THIS LINE
    this.humanShoot = new HumanShoot(this); // ADD THIS LINE
    this.hasSpawned = false; // Track if we've already spawned NPCs
  }

  loadConfig(config) {
    console.log(`[${this.name}] Loading configuration from destromod-config.yaml...`);
    this.config = config;
  }

  init(server) {
    console.log(`[${this.name}] Initializing AI`);

    // CRITICAL FIX: Patch sendDeathMetrics to prevent range errors
  const originalSendDeathMetrics = server.sendDeathMetrics.bind(server);
  server.sendDeathMetrics = function(client) {
    console.log(`[${server.destroMOD?.name || 'destroMOD'}] [DEATH_METRICS_FIX] Death metrics called for: ${client?.character?.name || client?.character?.characterId || 'unknown'}`);
    
    // Ensure character has valid metrics
    if (!client?.character?.metrics) {
      console.log(`[${server.destroMOD?.name || 'destroMOD'}] [DEATH_METRICS_FIX] Creating missing metrics object`);
      client.character.metrics = {};
    }
    
    // Fix the specific issue causing the range error
    if (!client.character.metrics.startedSurvivingTP || 
        typeof client.character.metrics.startedSurvivingTP !== 'number' ||
        client.character.metrics.startedSurvivingTP > Date.now()) {
      console.log(`[${server.destroMOD?.name || 'destroMOD'}] [DEATH_METRICS_FIX] Fixing invalid startedSurvivingTP: ${client.character.metrics.startedSurvivingTP}`);
      client.character.metrics.startedSurvivingTP = Date.now();
    }
    
    // Ensure all required numeric fields exist and are valid
    const metrics = client.character.metrics;
    if (!metrics.recipesDiscovered || metrics.recipesDiscovered < 0) metrics.recipesDiscovered = 0;
    if (!metrics.zombiesKilled || metrics.zombiesKilled < 0) metrics.zombiesKilled = 0;
    if (!metrics.wildlifeKilled || metrics.wildlifeKilled < 0) metrics.wildlifeKilled = 0;
    if (!metrics.vehiclesDestroyed || metrics.vehiclesDestroyed < 0) metrics.vehiclesDestroyed = 0;
    if (!metrics.playersKilled || metrics.playersKilled < 0) metrics.playersKilled = 0;
    
    console.log(`[${server.destroMOD?.name || 'destroMOD'}] [DEATH_METRICS_FIX] Calling original sendDeathMetrics with fixed metrics`);
    return originalSendDeathMetrics(client);
  };


    this.zombieAI.startup(server);
    this.humanAI.startup(server);
    this.armorDamage.init(server);
    this.armorDamage.patchHitmarkerSystem(server);
   // this.weaponDebugger.init(server); // ADD THIS LINE 

    // Store reference on server
    server.destroMOD = this;

    // CRITICAL: Patch NPC damage system to clear loadout before death
    this.patchNPCDeathSystem(server);
    
    // NEW: Patch visual equipment removal when items break
    this.patchVisualEquipmentRemoval(server);

    // Simple auto-spawn test - no commands, just spawn NPCs automatically
    this.setupAutoSpawn(server);

    if (this.config.chatTextMessage) {
      setTimeout(() => {
        console.log(`[${this.name}] Please wait for the other window as it launches the game...`);
        server.sendDataToAll('SendChatText', {
          message: this.config.chatTextMessage,
          channel: 1
        });
      }, 5000);
    }
  }

patchVisualEquipmentRemoval(server) {
    console.log(`[${this.name}] Patching visual equipment removal system...`);
    
    // Store the original damageItem function
    const originalDamageItem = server.damageItem.bind(server);
    
    // Override the server's damageItem function to detect destroyed items
    server.damageItem = function(character, item, damage) {
      
      // CRITICAL: Store equipment state BEFORE calling original function
      let equipmentBackup = null;
      if (character.isHumanNPC === true && character._equipment) {
        equipmentBackup = JSON.parse(JSON.stringify(character._equipment));
      }
      
      // Call the original function
      const result = originalDamageItem(character, item, damage);
      
      // Check if this is a human NPC and if an armor/helmet item was destroyed
      if (character.isHumanNPC === true && item && item.currentDurability <= 0 && equipmentBackup) {
        
        console.log(`[${server.destroMOD?.name || 'destroMOD'}] [VISUAL_REMOVAL] Item ${item.itemDefinitionId} destroyed on NPC ${character.characterId}`);
        
        // CRITICAL: Restore equipment before removal (in case original function modified it)
        character._equipment = equipmentBackup;
        
        // Determine what type of item was destroyed and remove from visual equipment
        const itemId = item.itemDefinitionId;
        
        // IMMEDIATE REMOVAL: Call the removal function right away
        setTimeout(() => {
          // Check if it's armor (LoadoutSlot 38 = EquipSlot 100)
          if (itemId === 2271 || (character._loadout && character._loadout[38] && character._loadout[38].itemDefinitionId === itemId)) {
            console.log(`[${server.destroMOD?.name || 'destroMOD'}] [VISUAL_REMOVAL] Removing destroyed armor from EquipSlot 100...`);
            server.destroMOD.removeNPCEquipmentVisually(character, 100, 'armor', server); // EquipSlots.ARMOR = 100
          }
          
          // Check if it's helmet (LoadoutSlot 11 = EquipSlot 1)  
          if (itemId === 3414 || (character._loadout && character._loadout[11] && character._loadout[11].itemDefinitionId === itemId)) {
            console.log(`[${server.destroMOD?.name || 'destroMOD'}] [VISUAL_REMOVAL] Removing destroyed helmet from EquipSlot 1...`);
            server.destroMOD.removeNPCEquipmentVisually(character, 1, 'helmet', server); // EquipSlots.HEAD = 1
          }
        }, 50); // Very small delay to ensure damage processing is complete
      }
      
      return result;
    };
    
    console.log(`[${this.name}] Visual equipment removal system patched`);
  }

  // ENHANCED: Equipment removal with better state management
  removeNPCEquipmentVisually(npc, equipSlotId, itemType, server) {
    try {
      console.log(`[${this.name}] [VISUAL_REMOVAL] Removing ${itemType} from NPC ${npc.characterId} EquipSlot ${equipSlotId}`);
      
      // Check what equipment exists before removal
      const equipmentBefore = Object.keys(npc._equipment || {});
      console.log(`[${this.name}] [VISUAL_REMOVAL] Equipment before removal:`, equipmentBefore);
      
      // Verify the item actually exists in equipment
      if (!npc._equipment || !npc._equipment[equipSlotId]) {
        console.log(`[${this.name}] [VISUAL_REMOVAL] ERROR: Equipment slot ${equipSlotId} for ${itemType} not found! Available slots:`, equipmentBefore);
        console.log(`[${this.name}] [VISUAL_REMOVAL] This suggests the equipment was already removed by another system.`);
        return; // Don't proceed if the item isn't there
      }
      
      // Store the removed item info before deletion
      const removedItem = npc._equipment[equipSlotId];
      console.log(`[${this.name}] [VISUAL_REMOVAL] About to remove: ${itemType} (${removedItem.modelName}) from EquipSlot ${equipSlotId}`);
      
      // Remove ONLY the specific destroyed item from equipment tracking
      delete npc._equipment[equipSlotId];
      
      const equipmentAfter = Object.keys(npc._equipment || {});
      console.log(`[${this.name}] [VISUAL_REMOVAL] Equipment after removal:`, equipmentAfter);
      
      // Method 1: Send full equipment update with remaining items (SAFEST METHOD)
      try {
        const remainingEquipment = Object.keys(npc._equipment || {});
        
        console.log(`[${this.name}] [VISUAL_REMOVAL] Rebuilding equipment list. Remaining slots:`, remainingEquipment);
        
        const equipmentSlots = remainingEquipment.map(slotId => ({
          equipmentSlotId: parseInt(slotId),
          equipmentSlotData: {
            equipmentSlotId: parseInt(slotId),
            guid: npc._equipment[slotId].guid,
            effectId: npc._equipment[slotId].effectId || 0,
            tintAlias: npc._equipment[slotId].tintAlias || "Default",
            decalAlias: npc._equipment[slotId].decalAlias || "#"
          }
        }));
        
        const attachmentData = remainingEquipment.map(slotId => ({
          modelName: npc._equipment[slotId].modelName,
          effectId: npc._equipment[slotId].effectId || 0,
          textureAlias: npc._equipment[slotId].textureAlias || "Default",
          tintAlias: npc._equipment[slotId].tintAlias || "Default",
          decalAlias: npc._equipment[slotId].decalAlias || "#",
          slotId: parseInt(slotId),
          SHADER_PARAMETER_GROUP: npc._equipment[slotId].SHADER_PARAMETER_GROUP || []
        }));
        
        server.sendDataToAllWithSpawnedEntity(
          server._npcs,
          npc.characterId,
          "Equipment.SetCharacterEquipment",
          {
            characterData: {
              profileId: 5,
              characterId: npc.characterId
            },
            unknownDword1: 0,
            tintAlias: "Default",
            decalAlias: "#",
            equipmentSlots: equipmentSlots,
            attachmentData: attachmentData,
            unknownBoolean1: true
          }
        );
        console.log(`[${this.name}] [VISUAL_REMOVAL] Sent SetCharacterEquipment update - removed ${itemType}, ${remainingEquipment.length} items remaining`);
        
        // Log what should still be visible
        remainingEquipment.forEach(slotId => {
          const item = npc._equipment[slotId];
          console.log(`[${this.name}] [VISUAL_REMOVAL] Still visible - Slot ${slotId}: ${item.modelName}`);
        });
        
      } catch (error) {
        console.log(`[${this.name}] [VISUAL_REMOVAL] Method 1 failed:`, error.message);
      }
      
      console.log(`[${this.name}] [VISUAL_REMOVAL] Successfully removed ${itemType} from EquipSlot ${equipSlotId}`);
      
    } catch (error) {
      console.error(`[${this.name}] [VISUAL_REMOVAL] Error removing ${itemType} visually:`, error);
    }
  }

  createHumanNPCLootBag(server, npc) {
  try {
    console.log(`[${this.name}] Creating human NPC loot bag...`);
    
    const path = require('path');
    const { Lootbag } = require(path.join(process.cwd(), 'node_modules/h1z1-server/out/servers/ZoneServer2016/entities/lootbag'));
    const { ModelIds } = require(path.join(process.cwd(), 'node_modules/h1z1-server/out/servers/ZoneServer2016/models/enums'));
    
    const lootbagCharacterId = this.generateGuid(server);
    
    const lootbag = new Lootbag(
      lootbagCharacterId,
      server.getTransientId(lootbagCharacterId),
      ModelIds.LOOT_BAG_LARGE,
      new Float32Array([
        npc.state.position[0] + 0.7,
        npc.state.position[1] + 0.1,
        npc.state.position[2] + 0.7
      ]),
      new Float32Array([0, 0, 0, 0]),
      server
    );
    
    const container = lootbag.getContainer();
    if (container) {
      // Use custom loot bag system like zombies
      this.addHumanNPCLoot(server, null, lootbag, container, npc);
    }
    
    server._lootbags[lootbagCharacterId] = lootbag;
    console.log(`[${this.name}] Human NPC loot bag created: ${lootbagCharacterId}`);
    
  } catch (error) {
    console.error(`[${this.name}] Error creating human NPC loot bag:`, error);
  }
}

  setupAutoSpawn(server) {
    console.log(`[${this.name}] Setting up auto-spawn system...`);
    
    // Check for connected clients every 5 seconds and spawn NPCs
    const spawnCheck = setInterval(() => {
      const clients = Object.values(server._clients);
      const connectedClient = clients.find(client => client && client.character && client.character.isAlive);
      
      if (connectedClient && !this.hasSpawned) {
        console.log(`[${this.name}] Found connected client: ${connectedClient.character.name}, spawning NPCs`);
        this.hasSpawned = true; // Only spawn once
        clearInterval(spawnCheck);
        
        // Send welcome message and set up equipment when player is ready
        server.sendChatText(connectedClient, "=== destroMOD Active ===");
        server.sendChatText(connectedClient, "Spawning test NPCs now...");
        
        // Spawn NPCs immediately
        setTimeout(() => {
          this.spawnTestNPCs(server, connectedClient);
          
          // Wait for player to be fully initialized, then equip NPCs
          this.waitForPlayerReady(server, connectedClient, () => {
            console.log(`[${this.name}] Player is fully loaded, sending equipment to NPCs...`);
            this.equipAllHumanNPCs(server, connectedClient);
          });
          
        }, 2000);
      }
    }, 5000);
    
    console.log(`[${this.name}] Auto-spawn system ready - checking for players every 5 seconds`);
  }

  // Spawn test NPCs
  spawnTestNPCs(server, client) {
    console.log(`[${this.name}] Spawning test human NPC for ${client.character?.name}`);
    
    try {
      // Spawn only 1 human NPC
      const humanSpawned = this.spawnHumanNPC(server, client);
      
      if (humanSpawned) {
        server.sendChatText(client, "✅ Spawned 1 human NPC with visible equipment!");
        server.sendChatText(client, "Equipment will be applied when you're fully loaded");
        server.sendChatText(client, "Commands: /debug_npc <id>, /scan_npc_items <id>, /list_npcs");
        server.sendChatText(client, "Armor commands: /debug_armor <id>, /test_armor_damage <damage> <id>");
        console.log(`[${this.name}] Successfully spawned human NPC`);
      } else {
        server.sendChatText(client, "❌ Failed to spawn human NPC - check server console");
        console.log(`[${this.name}] Failed to spawn human NPC`);
      }
      
    } catch (error) {
      console.error(`[${this.name}] Error spawning human NPC:`, error);
      server.sendChatText(client, "❌ Error spawning NPC - check server console");
    }
  }

  // WORKING Human NPC Spawn Method (based on working version)
  spawnHumanNPC(server, client) {
    try {
      console.log(`[${this.name}] Spawning human NPC with working equipment system...`);
      
      const characterId = server.generateGuid();
      const transient = server.getTransientId(characterId);
      
      // Calculate random offsets for the spawn position
      const randomXOffset = (Math.random() * 10) - 5;   // Result is between -5 and 5
      const randomZOffset = (Math.random() * 10) + 20;  // Result is between 20 and 30

      // Spawn position with random offset from player
      const spawnPos = [
        client.character.state.position[0] + randomXOffset,
        client.character.state.position[1],
        client.character.state.position[2] + randomZOffset,
        1
      ];
      
      const path = require('path');
      const { Npc } = require(path.join(process.cwd(), 'node_modules/h1z1-server/out/servers/ZoneServer2016/entities/npc'));
      
      const humanNpc = new Npc(
        characterId,
        transient,
        9469, // ModelIds.SURVIVOR_MALE_HEAD_01
        spawnPos,
        client.character.state.rotation,
        server
      );

      // Set human properties
      humanNpc.isHumanNPC = true;
      humanNpc.health = 8000;
      humanNpc.maxHealth = 8000;
      humanNpc.npcMeleeDamage = 0;
      humanNpc.weapon = 2229; // AK-47

      // ADD THIS NEW SECTION - Initialize NPC metrics to prevent sendDeathMetrics errors
      humanNpc.metrics = {
      recipesDiscovered: 0,
      zombiesKilled: 0,
      startedSurvivingTP: Date.now(), // This prevents the negative minutesSurvived calculation
      wildlifeKilled: 0,
      vehiclesDestroyed: 0,
      playersKilled: 0
      };
      console.log(`[${this.name}] Initialized NPC metrics for ${characterId} to prevent death metrics errors`);
      
      // Set up character properties for proper equipment rendering
      humanNpc.headActor = "SurvivorMale_Head_01.adr";
      humanNpc.gender = 1; // Male
      humanNpc.loadoutId = 5; // Character loadout
      humanNpc.currentLoadoutSlot = 1; // Primary weapon slot
      
      // Initialize equipment systems
      humanNpc._loadout = {};
      humanNpc._equipment = {};
      humanNpc._containers = {};
      
      // WORKING EQUIPMENT SETUP (from working version but modified for no death bags)
      // Generate GUIDs for visible equipment
      const weaponGuid = this.generateGuid(server);
      const armorGuid = this.generateGuid(server);
      const helmetGuid = this.generateGuid(server);

      const weaponDef = server.getItemDefinition(2229); // AK-47
      
      // Create weapon item using server.generateItem to get proper weapon data
      const weaponItem = server.generateItem(2229, 1, 100); // AK47, count 1, durability 100
      weaponItem.itemGuid = weaponGuid; // Use our custom GUID
      
      console.log(`[${this.name}] [DEBUG] Starting equipment setup for NPC...`);
      
      // Use Laminated Tactical Body Armor
      const armorDef = server.getItemDefinition(2271);
      const armorId = 2271;

      if (!armorDef) {
      console.error(`[${this.name}] CRITICAL ERROR: Armor ID 2271 not found in server definitions!`);
      return false; // Fail the spawn entirely
}

      console.log(`[${this.name}] Using Laminated Tactical Body Armor (ID: 2271)`);

      // Use Firefighter Tactical Helmet
      const helmetDef = server.getItemDefinition(3414);
      const helmetId = 3414;

      if (!helmetDef) {
        console.error(`[${this.name}] CRITICAL ERROR: Helmet ID 3414 not found in server definitions!`);
      return false;
}

console.log(`[${this.name}] Using Firefighter Tactical Helmet (ID: 3414)`);
      
      // HYBRID APPROACH: LoadoutSlots for protection + EquipSlots for visibility
      // This gives NPCs proper armor protection while preventing death bags
      
      // CRITICAL: Create loadout items for protection (will be cleared before death)
      humanNpc._loadout = {}; // Start empty, add protection items
      humanNpc._equipment = {}; // Visual equipment
      
      // Store durability tracking for loot transfer
      humanNpc._equipmentDurability = {};
      
      // Set up weapon equipment
      if (weaponDef) {
        console.log(`[${this.name}] Setting up AK-47 equipment...`);
        
        // HYBRID: Add to LoadoutSlots for weapon functionality (damage, shooting)
        humanNpc._loadout[1] = {
          itemDefinitionId: 2229,
          itemGuid: weaponGuid,
          slotId: 1,
          stackCount: 1,
          currentDurability: 1000,
          containerGuid: "0xFFFFFFFFFFFFFFFF",
          loadoutItemOwnerGuid: humanNpc.characterId,
          weapon: weaponItem.weapon // CRITICAL: Include weapon data for shooting
        };
        
        // Store durability for loot transfer
        humanNpc._equipmentDurability[2229] = 1000;
        
        // HYBRID: Add to EquipSlots for visual appearance
        const equipmentSlotId = weaponDef.ACTIVE_EQUIP_SLOT_ID || 7;
        humanNpc._equipment[equipmentSlotId] = {
          modelName: weaponDef.MODEL_NAME || "Weapon_AK47_3P.adr",
          slotId: equipmentSlotId,
          guid: weaponGuid,
          textureAlias: weaponDef.TEXTURE_ALIAS || "Default",
          effectId: weaponDef.EFFECT_ID || 0,
          tintAlias: "Default",
          decalAlias: "#",
          SHADER_PARAMETER_GROUP: server.getShaderParameterGroup(2229) || [],
          itemDefinitionId: 2229
        };
        
        console.log(`[${this.name}] HYBRID: Weapon added to both LoadoutSlot 1 (protection) and EquipSlot ${equipmentSlotId} (visual)`);
      } else {
        console.log(`[${this.name}] [ERROR] Could not find weapon definition for AK-47 (2229)`);
      }
      
      // Add Laminated Tactical Body Armor
      console.log(`[${this.name}] [DEBUG] Starting armor setup - armorDef exists: ${!!armorDef}`);
      if (armorDef) {
        console.log(`[${this.name}] Setting up Laminated Tactical Body Armor (ID: ${armorId})...`);
        console.log(`[${this.name}] [DEBUG] Armor definition:`, {
          NAME: armorDef.NAME,
          MODEL_NAME: armorDef.MODEL_NAME,
          PASSIVE_EQUIP_SLOT_ID: armorDef.PASSIVE_EQUIP_SLOT_ID,
          IS_ARMOR: armorDef.IS_ARMOR
        });
        
        // HYBRID: Add to LoadoutSlots for damage protection
        humanNpc._loadout[38] = {
          itemDefinitionId: armorId,
          itemGuid: armorGuid,
          slotId: 38,
          stackCount: 1,
          currentDurability: 1000, // CRITICAL: Full durability for armor damage testing
          containerGuid: "0xFFFFFFFFFFFFFFFF",
          loadoutItemOwnerGuid: humanNpc.characterId
        };
        
        // Store durability for loot transfer
        humanNpc._equipmentDurability[armorId] = 1000;
        console.log(`[${this.name}] [DEBUG] Added armor to loadout slot 38 for protection with durability 1000`);
        
        // HYBRID: Add to EquipSlots for visual appearance
        const armorEquipSlotId = armorDef.PASSIVE_EQUIP_SLOT_ID || 100;
        
        // Handle gender in model name - replace <gender> with Male/Female
        let modelName = armorDef.MODEL_NAME || "SurvivorMale_Armor_Kevlar_Basic_Velcro.adr";
        if (modelName.includes("<gender>")) {
          modelName = modelName.replace("<gender>", humanNpc.gender === 1 ? "Male" : "Female");
        }
        
        // Create armor equipment entry
        humanNpc._equipment[armorEquipSlotId] = {
          modelName: modelName,
          slotId: armorEquipSlotId,
          guid: armorGuid,
          textureAlias: armorDef.TEXTURE_ALIAS || "Default",
          effectId: armorDef.EFFECT_ID || 0,
          tintAlias: "Default",
          decalAlias: "#",
          SHADER_PARAMETER_GROUP: server.getShaderParameterGroup(armorId) || []
        };
        
        console.log(`[${this.name}] [DEBUG] Armor equipment setup complete:`, {
          modelName: modelName,
          armorId: armorId,
          textureAlias: armorDef.TEXTURE_ALIAS || "Default",
          shaderParamsCount: (server.getShaderParameterGroup(armorId) || []).length
        });
        console.log(`[${this.name}] [DEBUG] Added armor to equipment slot ${armorEquipSlotId}`);
        
        console.log(`[${this.name}] HYBRID: Armor added to LoadoutSlot 38 (protection) and EquipSlot ${armorEquipSlotId} (visual)`);
        
      } else {
        console.log(`[${this.name}] [ERROR] Could not find any working armor definition - tried IDs: 2271, 2784, 14, 15, 16, 2050, 2051, 2052`);
      }
      
      // NEW: Add Firefighter Tactical Helmet
      console.log(`[${this.name}] [DEBUG] Starting helmet setup - helmetDef exists: ${!!helmetDef}`);
      if (helmetDef) {
        console.log(`[${this.name}] Setting up Firefighter Tactical Helmet (ID: ${helmetId})...`);
        console.log(`[${this.name}] [DEBUG] Helmet definition:`, {
          NAME: helmetDef.NAME,
          MODEL_NAME: helmetDef.MODEL_NAME,
          PASSIVE_EQUIP_SLOT_ID: helmetDef.PASSIVE_EQUIP_SLOT_ID,
          IS_ARMOR: helmetDef.IS_ARMOR
        });
        
        // HYBRID: Add to LoadoutSlots for headshot protection
        humanNpc._loadout[11] = {
          itemDefinitionId: helmetId,
          itemGuid: helmetGuid,
          slotId: 11,
          stackCount: 1,
          currentDurability: 100, // FIXED: Helmet should be 100 durability, not 1000
          containerGuid: "0xFFFFFFFFFFFFFFFF",
          loadoutItemOwnerGuid: humanNpc.characterId
        };
        
        // Store durability for loot transfer
        humanNpc._equipmentDurability[helmetId] = 100; // FIXED: 100 not 1000
        console.log(`[${this.name}] [DEBUG] Added helmet to loadout slot 11 (HEAD) for protection with durability 100`);
        
        // Handle gender in model name - replace <gender> with Male/Female
        let helmetModelName = helmetDef.MODEL_NAME || "SurvivorMale_Head_Helmet_ParaMilitary.adr";
        if (helmetModelName.includes("<gender>")) {
          helmetModelName = helmetModelName.replace("<gender>", humanNpc.gender === 1 ? "Male" : "Female");
        }
        
        // HYBRID: Add to EquipSlots for visual appearance
        const helmetEquipSlotId = helmetDef.PASSIVE_EQUIP_SLOT_ID || 1;
        
        // Create helmet equipment entry
        humanNpc._equipment[helmetEquipSlotId] = {
          modelName: helmetModelName,
          slotId: helmetEquipSlotId,
          guid: helmetGuid,
          textureAlias: helmetDef.TEXTURE_ALIAS || "Default",
          effectId: helmetDef.EFFECT_ID || 0,
          tintAlias: "Default",
          decalAlias: "#",
          SHADER_PARAMETER_GROUP: server.getShaderParameterGroup(helmetId) || []
        };
        console.log(`[${this.name}] [DEBUG] Added helmet to equipment slot ${helmetEquipSlotId}`);
        
        console.log(`[${this.name}] HYBRID: Helmet added to LoadoutSlot 11 (protection) and EquipSlot ${helmetEquipSlotId} (visual)`);
        
      } else {
        console.log(`[${this.name}] [ERROR] Could not find any working helmet definition - tried IDs: 3414, 2, 3, 4, 5, 6`);
      }
      
      console.log(`[${this.name}] [DEBUG] About to add NPC to server...`);
      
      // Add to server first
      server._npcs[characterId] = humanNpc;
      console.log(`[${this.name}] [DEBUG] Added NPC to server._npcs`);
      
      server.aiManager.addEntity(humanNpc);
      console.log(`[${this.name}] [DEBUG] Added NPC to aiManager`);
      
      // Store the NPC for delayed equipment setup
      humanNpc.needsEquipmentSetup = true;
      
      // FINAL DEBUG: Complete equipment verification
      console.log(`[${this.name}] [DEBUG] FINAL VERIFICATION - All equipment slots:`);
      console.log(`[${this.name}] [DEBUG] - Loadout slots:`, Object.keys(humanNpc._loadout));
      console.log(`[${this.name}] [DEBUG] - Equipment slots:`, Object.keys(humanNpc._equipment));
      console.log(`[${this.name}] [DEBUG] - Durability tracking:`, humanNpc._equipmentDurability);
      
      console.log(`[${this.name}] Human NPC ${characterId} spawned with visible equipment setup, no death bag will be created`);
      return true;
      
    } catch (error) {
      console.error(`[${this.name}] Error spawning human NPC:`, error);
      console.error(`[${this.name}] Stack trace:`, error.stack);
      return false;
    }
  }

  // ===========================================
  // PLAYER READY DETECTION
  // ===========================================

  waitForPlayerReady(server, client, callback) {
    let hasExecuted = false; // Prevent duplicate execution
    
    const checkInterval = setInterval(() => {
      // Check if player character is fully initialized
      if (client && client.character && client.character.initialized && !client.isLoading && !hasExecuted) {
        console.log(`[${this.name}] Player ${client.character.name} is ready!`);
        hasExecuted = true;
        clearInterval(checkInterval);
        callback();
      } else if (!hasExecuted) {
        console.log(`[${this.name}] Waiting for player to be ready... (initialized: ${client?.character?.initialized}, isLoading: ${client?.isLoading})`);
      }
    }, 1000); // Check every second
    
    // Timeout after 30 seconds
    setTimeout(() => {
      if (!hasExecuted) {
        console.log(`[${this.name}] Player ready timeout - forcing equipment setup`);
        hasExecuted = true;
        clearInterval(checkInterval);
        callback();
      }
    }, 30000);
  }

  equipAllHumanNPCs(server, client) {
    console.log(`[EQUIP_ALL] Starting to equip all human NPCs...`);
    
    // Find all NPCs with human model
    const allNpcs = Object.keys(server._npcs);
    const humanModelNpcs = allNpcs.filter(id => {
      const npc = server._npcs[id];
      return npc.actorModelId === 9469; // SURVIVOR_MALE_HEAD_01
    });
    
    console.log(`[EQUIP_ALL] Found ${humanModelNpcs.length} human model NPCs to equip`);
    
    humanModelNpcs.forEach((npcId, index) => {
      const npc = server._npcs[npcId];
      
      console.log(`[EQUIP_ALL] Equipping NPC ${index + 1}/${humanModelNpcs.length}: ${npcId}`);
      
      // Ensure it's flagged as human
      if (!npc.isHumanNPC) {
        npc.isHumanNPC = true;
        npc.weapon = 2229;
        npc.gender = 1;
        npc.loadoutId = 5;
        npc.currentLoadoutSlot = 1;
      }
      
      // ENHANCED: Only send equipment packets if NPC already has equipment
      // (The spawn function should have already set up the equipment)
      if (npc._equipment && Object.keys(npc._equipment).length > 0) {
        console.log(`[EQUIP_ALL] [DEBUG] NPC ${npcId} has equipment, sending packets...`);
        console.log(`[EQUIP_ALL] [DEBUG] Equipment slots to send:`, Object.keys(npc._equipment));
        
        // Send equipment packets with staggered timing
        setTimeout(() => {
          try {
            // WORKING: Send equipment using the working packet structure
            const equipmentSlots = Object.keys(npc._equipment).map(slotId => ({
              equipmentSlotId: parseInt(slotId),
              equipmentSlotData: {
                equipmentSlotId: parseInt(slotId),
                guid: npc._equipment[slotId].guid,
                effectId: npc._equipment[slotId].effectId || 0,
                tintAlias: npc._equipment[slotId].tintAlias || "Default",
                decalAlias: npc._equipment[slotId].decalAlias || "#"
              }
            }));
            
            const attachmentData = Object.keys(npc._equipment).map(slotId => ({
              modelName: npc._equipment[slotId].modelName,
              effectId: npc._equipment[slotId].effectId || 0,
              textureAlias: npc._equipment[slotId].textureAlias || "Default",
              tintAlias: npc._equipment[slotId].tintAlias || "Default",
              decalAlias: npc._equipment[slotId].decalAlias || "#",
              slotId: parseInt(slotId),
              SHADER_PARAMETER_GROUP: npc._equipment[slotId].SHADER_PARAMETER_GROUP || []
            }));
            
            console.log(`[EQUIP_ALL] [DEBUG] Sending equipment for ${equipmentSlots.length} slots:`, equipmentSlots.map(e => e.equipmentSlotId));
            console.log(`[EQUIP_ALL] [DEBUG] Equipment models being sent:`, attachmentData.map(a => ({ slot: a.slotId, model: a.modelName })));
            
            // Send equipment packet using working structure
            server.sendDataToAllWithSpawnedEntity(
              server._npcs,
              npcId,
              "Equipment.SetCharacterEquipment",
              {
                characterData: {
                  profileId: 5,
                  characterId: npcId
                },
                unknownDword1: 0,
                tintAlias: "Default",
                decalAlias: "#",
                equipmentSlots: equipmentSlots,
                attachmentData: attachmentData,
                unknownBoolean1: true
              }
            );
            
            console.log(`[EQUIP_ALL] Equipment packets sent for NPC ${npcId} (weapon + armor + helmet)`);
            
          } catch (error) {
            console.log(`[EQUIP_ALL] Error equipping NPC ${npcId}:`, error);
          }
        }, index * 500); // Stagger by 500ms each
        
      } else {
        console.log(`[EQUIP_ALL] [WARNING] NPC ${npcId} has no equipment data - spawn function may have failed`);
        console.log(`[EQUIP_ALL] [DEBUG] NPC equipment state:`, {
          hasLoadout: !!npc._loadout,
          hasEquipment: !!npc._equipment,
          loadoutSlots: Object.keys(npc._loadout || {}),
          equipmentSlots: Object.keys(npc._equipment || {})
        });
      }
    });
  }

// Simple GUID generation using server's native method
generateGuid(server) {
  return server.generateGuid();
}

  // ===========================================
  // HYBRID SYSTEM: LOADOUT CLEARING & DURABILITY TRANSFER
  // ===========================================

  patchNPCDeathSystem(server) {
    console.log(`[${this.name}] Patching NPC death system for hybrid loadout clearing...`);
    
    // Wait for humanAI to finish its setup, then patch both damage and hit marker functions
    setTimeout(() => {
      console.log(`[${this.name}] [HYBRID] Patching damage function AFTER humanAI setup...`);
      
      try {
        // Get Npc class from the server modules
        const path = require('path');
        const { Npc } = require(path.join(process.cwd(), 'node_modules/h1z1-server/out/servers/ZoneServer2016/entities/npc'));
        
        // PATCH 1: Damage function (existing)
        const humanAIPatchedDamage = Npc.prototype.damage;
        
        Npc.prototype.damage = async function(server, damageInfo) {
          
          // CRITICAL DEBUG: Log all damage events for human NPCs
          if (this.isHumanNPC === true) {
            console.log(`[${server.destroMOD?.name || 'destroMOD'}] [DAMAGE_DEBUG] Human NPC ${this.characterId} taking damage:`);
            console.log(`  - Damage: ${damageInfo.damage}`);
            console.log(`  - Hit Location: ${damageInfo.hitLocation || 'UNKNOWN'}`);
            console.log(`  - Source: ${damageInfo.source || 'UNKNOWN'}`);
            console.log(`  - Has Armor: ${!!this._loadout[38]}`);
            console.log(`  - Has Helmet: ${!!this._loadout[11]}`);
            
            // ENHANCED DEBUG: Log ALL properties of damageInfo to see what's available
            console.log(`  - ALL damageInfo properties:`, Object.keys(damageInfo));
            console.log(`  - Full damageInfo object:`, JSON.stringify(damageInfo, null, 2));
            
            // Check if this should trigger armor damage reduction
            const hitLocation = damageInfo.hitLocation;
            const realHitLocation = damageInfo.hitReport?.hitLocation;
            
            console.log(`  - Real hit location from hitReport: ${realHitLocation}`);
            
            // Use the real hit location from hitReport
            const actualHitLocation = realHitLocation || hitLocation;
            const hitLower = actualHitLocation ? actualHitLocation.toLowerCase() : '';
            
            // COMPLETE HIT DETECTION: Based on the H1Z1 server pvpStats code
            
            // Armor triggers for SPINE hits only (torso/back area)
            const shouldTriggerArmor = hitLower && (
              hitLower === 'spineupper' ||
              hitLower === 'spinelower' ||
              hitLower === 'spinemiddle'
            );
              
            // Helmet triggers for HEAD/NECK hits only  
            const shouldTriggerHelmet = hitLower && (
              hitLower === 'head' || 
              hitLower === 'glasses' ||
              hitLower === 'neck'
            );
            
            // NO PROTECTION for legs and arms
            const isLegShot = hitLower && (
              hitLower === 'l_hip' || hitLower === 'r_hip' ||
              hitLower === 'l_knee' || hitLower === 'r_knee' ||
              hitLower === 'l_ankle' || hitLower === 'r_ankle'
            );
            
            const isArmShot = hitLower && (
              hitLower === 'l_elbow' || hitLower === 'r_elbow' ||
              hitLower === 'r_shoulder' || hitLower === 'l_shoulder' ||
              hitLower === 'r_wrist' || hitLower === 'l_wrist'
            );
            
            // NEW: Limb damage reduction for specific hit locations
            const isReducedDamageLimb = hitLower && (
              hitLower === 'l_knee' || hitLower === 'r_knee' ||
              hitLower === 'l_ankle' || hitLower === 'r_ankle' ||
              hitLower === 'l_elbow' || hitLower === 'r_elbow' ||
              hitLower === 'r_wrist' || hitLower === 'l_wrist'
            );
            
            console.log(`  - Hit type: ${isLegShot ? 'LEG' : isArmShot ? 'ARM' : shouldTriggerArmor ? 'SPINE/TORSO' : shouldTriggerHelmet ? 'HEAD' : 'UNKNOWN'}`);
            console.log(`  - Should trigger armor reduction: ${shouldTriggerArmor} (hit: ${actualHitLocation})`);
            console.log(`  - Should trigger helmet reduction: ${shouldTriggerHelmet} (hit: ${actualHitLocation})`);
            console.log(`  - Should apply 50% limb reduction: ${isReducedDamageLimb} (hit: ${actualHitLocation})`);
            console.log(`  - Has armor in slot 38: ${!!this._loadout[38]}`);
            console.log(`  - Has helmet in slot 11: ${!!this._loadout[11]}`);
            
            // CRITICAL: Manually trigger armor/helmet damage if not being called
            if (shouldTriggerArmor && this._loadout[38]) {
              console.log(`  - MANUALLY TRIGGERING ARMOR DAMAGE REDUCTION`);
              const originalDamage = damageInfo.damage;
              damageInfo.damage = server.applyArmorDamageReduction(this, damageInfo.damage, 4);
              console.log(`  - Armor reduced damage: ${originalDamage} -> ${damageInfo.damage}`);
            } else if (shouldTriggerArmor && !this._loadout[38]) {
              console.log(`  - Would trigger armor but NO ARMOR EQUIPPED`);
            }
            
            if (shouldTriggerHelmet && this._loadout[11]) {
              console.log(`  - MANUALLY TRIGGERING HELMET DAMAGE REDUCTION`);
              const originalDamage = damageInfo.damage;
              damageInfo.damage = server.applyHelmetDamageReduction(this, damageInfo.damage, 1);
              console.log(`  - Helmet reduced damage: ${originalDamage} -> ${damageInfo.damage}`);
            } else if (shouldTriggerHelmet && !this._loadout[11]) {
              console.log(`  - Would trigger helmet but NO HELMET EQUIPPED`);
            }
            
            // NEW: Apply 50% damage reduction for specific limb shots
            if (isReducedDamageLimb && !shouldTriggerArmor && !shouldTriggerHelmet) {
              console.log(`  - APPLYING 50% LIMB DAMAGE REDUCTION`);
              const originalDamage = damageInfo.damage;
              damageInfo.damage = Math.round(damageInfo.damage * 0.5); // 50% reduction
              console.log(`  - Limb reduced damage: ${originalDamage} -> ${damageInfo.damage}`);
            }
          }
          
          // CRITICAL: Check if this will kill a human NPC and clear loadout BEFORE damage processing
          const willDie = (this.health - damageInfo.damage) <= 0 && this.isAlive;
          
          if (this.isHumanNPC === true && willDie && this._loadout && Object.keys(this._loadout).length > 0) {
            if (!this._loadoutCleared) {

              console.log(`[${server.destroMOD?.name || 'destroMOD'}] [DEBUG] NPC ${this.characterId} about to die`);
    console.log(`[${server.destroMOD?.name || 'destroMOD'}] [DEBUG] NPC metrics:`, this.metrics);
    console.log(`[${server.destroMOD?.name || 'destroMOD'}] [DEBUG] startedSurvivingTP:`, this.metrics?.startedSurvivingTP);
    
  
              console.log(`[${server.destroMOD?.name || 'destroMOD'}] [HYBRID] CRITICAL: NPC ${this.characterId} will die - clearing loadout before damage processing`);
              
              // CRITICAL FIX: Capture durability AFTER the damage has been applied in this function
              // The armor damage reduction has already been called above, so current durability is accurate
              if (server.destroMOD && typeof server.destroMOD.captureDurabilityBeforeDeath === 'function') {
                server.destroMOD.captureDurabilityBeforeDeath(this);
              }
              
              // Clear loadout to prevent death bag
              this._loadout = {};
              this._loadoutCleared = true;
              
              console.log(`[${server.destroMOD?.name || 'destroMOD'}] [HYBRID] CRITICAL: Loadout cleared - no death bag should be created`);
            }
          }
          
          // Call humanAI's patched damage function
          return await humanAIPatchedDamage.apply(this, arguments);
        };

        // PATCH 2: OnProjectileHit function to fix hitmarker sounds
        const originalOnProjectileHit = Npc.prototype.OnProjectileHit;
        
        Npc.prototype.OnProjectileHit = function(server, damageInfo) {
          // For human NPCs, use normal hitmarker logic (our patched sendHitmarker will handle the correction)
          if (this.isHumanNPC === true) {
            if (
              server.isHeadshotOnly &&
              damageInfo.hitReport?.hitLocation != "HEAD" &&
              this.isAlive
            )
              return;

            const client = server.getClientByCharId(damageInfo.entity);
            if (client && this.isAlive) {
              const hasHelmetBefore = this.hasHelmet(server);
              const hasArmorBefore = this.hasArmor(server);
              
              // Send normal hitmarker - our patched sendHitmarker function will correct the sounds
              server.sendHitmarker(
                client,
                damageInfo.hitReport?.hitLocation,
                this.hasHelmet(server),   // Current helmet state
                this.hasArmor(server),    // Current armor state  
                hasHelmetBefore,          // Previous helmet state
                hasArmorBefore            // Previous armor state
              );
              
              console.log(`[${server.destroMOD?.name || 'destroMOD'}] [HITMARKER] Sent hitmarker for ${damageInfo.hitReport?.hitLocation} hit`);
            }

            // Apply headshot multiplier (from original npc.ts code)
            switch (damageInfo.hitReport?.hitLocation) {
              case "HEAD":
              case "GLASSES":
              case "NECK":
                damageInfo.damage *= 4;
                break;
              default:
                break;
            }

            // Call damage function (our patched version will handle the rest)
            this.damage(server, damageInfo);
          } else {
            // For non-human NPCs, use the original function
            return originalOnProjectileHit.apply(this, arguments);
          }
        };
        
        console.log(`[${this.name}] [HYBRID] Successfully patched both damage and OnProjectileHit functions`);
        
      } catch (error) {
        console.error(`[${this.name}] [HYBRID] Error patching functions:`, error.message);
      }
      
    }, 500); // Wait 500ms for humanAI to finish setup
    
    console.log(`[${this.name}] Scheduled post-humanAI damage patching`);
  }

  captureDurabilityBeforeDeath(npc) {
    console.log(`[${this.name}] [DURABILITY] Capturing current durability from NPC loadout...`);
    
    if (!npc._loadout || !npc._equipmentDurability) {
      console.log(`[${this.name}] [DURABILITY] No loadout or durability tracking found`);
      return;
    }
    
    // CRITICAL: Clear the tracking and rebuild from actual current loadout state
    // This ensures we capture the real durability AFTER all damage has been applied
    const newDurabilityTracking = {};
    
    // Check what's actually still in the loadout (items that weren't destroyed)
    Object.values(npc._loadout).forEach(item => {
      if (item && item.itemDefinitionId && typeof item.currentDurability !== 'undefined') {
        const currentDurability = item.currentDurability;
        
        if (currentDurability > 0) {
          // Item still exists and has durability > 0
          newDurabilityTracking[item.itemDefinitionId] = currentDurability;
          console.log(`[${this.name}] [DURABILITY] Item ${item.itemDefinitionId}: durability ${currentDurability} (WILL BE IN LOOT)`);
        } else {
          // Item was destroyed (durability 0) - don't track it
          console.log(`[${this.name}] [DURABILITY] Item ${item.itemDefinitionId}: DESTROYED (durability 0) - will NOT be in loot`);
        }
      }
    });
    
    // Replace the tracking with the accurate current state
    npc._equipmentDurability = newDurabilityTracking;
    
    console.log(`[${this.name}] [DURABILITY] Final durability tracking for loot:`, npc._equipmentDurability);
  }

  // ===========================================
  // CUSTOM HUMAN NPC LOOT SYSTEM - WITH DURABILITY TRANSFER
  // ===========================================

  addHumanNPCLoot(server, client, lootbag, container, npc) {
    console.log(`[${this.name}] [HUMAN_LOOT] Adding custom human NPC loot with durability transfer...`);
    
    // Use the passed NPC or find the recently died one
    if (!npc) {
      const recentlyDied = Object.values(server._npcs).find(n => 
        n.isHumanNPC && n.health <= 0 && n._equipmentDurability
      );
      if (recentlyDied) {
        npc = recentlyDied;
        console.log(`[${this.name}] [DURABILITY] Found recently died NPC with durability data`);
      }
    }
    
    const durabilityData = npc?._equipmentDurability || {};
    console.log(`[${this.name}] [DURABILITY] Using durability data:`, durabilityData);
    
    // AK-47 (100% chance - primary weapon) - VERIFIED ID 2229
    // Only add if durability > 0 (not destroyed)
    const ak47Durability = durabilityData[2229];
    if (ak47Durability && ak47Durability > 0) {
      const ak47Item = server.generateItem(2229, 1);
      if (ak47Item) {
        ak47Item.currentDurability = ak47Durability;
        server.addContainerItem(lootbag, ak47Item, container);
        console.log(`[${this.name}] [HUMAN_LOOT] Added AK-47 (durability: ${ak47Durability}) - manually set durability`);
      }
    } else {
      console.log(`[${this.name}] [HUMAN_LOOT] AK-47 destroyed or missing - not added to loot`);
    }
    
    // 7.62mm Ammo (100% chance - for the AK-47) - CORRECTED ID 2325
    const ammo762Item = server.generateItem(2325, 30);
    if (ammo762Item) {
      server.addContainerItem(lootbag, ammo762Item, container);
      console.log(`[${this.name}] [HUMAN_LOOT] Added 7.62mm Ammo x30`);
    }
    
    // Body Armor (100% chance) - VERIFIED ID 2271
    // Only add if durability > 0 (not destroyed)
    const armorDurability = durabilityData[2271];
    if (armorDurability && armorDurability > 0) {
      const armorItem = server.generateItem(2271, 1);
      if (armorItem) {
        armorItem.currentDurability = armorDurability;
        server.addContainerItem(lootbag, armorItem, container);
        console.log(`[${this.name}] [HUMAN_LOOT] Added Laminated Tactical Body Armor (durability: ${armorDurability}) - manually set durability`);
      }
    } else {
      console.log(`[${this.name}] [HUMAN_LOOT] Body Armor destroyed or missing - not added to loot`);
    }
    
    // Helmet (100% chance) - VERIFIED ID 3414
    // Only add if durability > 0 (not destroyed)
    const helmetDurability = durabilityData[3414];
    if (helmetDurability && helmetDurability > 0) {
      const helmetItem = server.generateItem(3414, 1);
      if (helmetItem) {
        helmetItem.currentDurability = helmetDurability;
        server.addContainerItem(lootbag, helmetItem, container);
        console.log(`[${this.name}] [HUMAN_LOOT] Added Firefighter Tactical Helmet (durability: ${helmetDurability}) - manually set durability`);
      }
    } else {
      console.log(`[${this.name}] [HUMAN_LOOT] Helmet destroyed or missing - not added to loot`);
    }
    
    // 9mm Rounds (75% chance) - CORRECTED ID 1998
    if (Math.random() < 0.75) {
      const ammo9mmItem = server.generateItem(1998, 20);
      if (ammo9mmItem) {
        server.addContainerItem(lootbag, ammo9mmItem, container);
        console.log(`[${this.name}] [HUMAN_LOOT] Added 9mm Rounds x20`);
      }
    }

    // m9 Pistol (100% chance) - 3381 (normal m9 is 1997)
      const m9Item = server.generateItem(3381, 1, 500);  // kuromu dragon m9 skin 3381
      if (m9Item) {
        server.addContainerItem(lootbag, m9Item, container);
        console.log(`[${this.name}] [HUMAN_LOOT] Added m9 Pistol`);
      }
    
    // First Aid Kit (60% chance) - CORRECTED ID 78, not 1717
    if (Math.random() < 0.60) {
      const firstAidItem = server.generateItem(78, 1);
      if (firstAidItem) {
        server.addContainerItem(lootbag, firstAidItem, container);
        console.log(`[${this.name}] [HUMAN_LOOT] Added First Aid Kit`);
      }
    }
    
    // Bandages (80% chance) - CORRECTED ID 24 need to double check its correct ID though
    if (Math.random() < 0.80) {
      const bandageItem = server.generateItem(24, 3);
      if (bandageItem) {
        server.addContainerItem(lootbag, bandageItem, container);
        console.log(`[${this.name}] [HUMAN_LOOT] Added Bandages x3`);
      }
    }
    
    console.log(`[${this.name}] [HUMAN_LOOT] Custom human loot with durability transfer complete`);
  }

  // ===========================================
  // DEBUG AND UTILITY METHODS
  // ===========================================

  debugNPCEquipment(server, npcId) {
    const npc = server._npcs[npcId];
    if (!npc) {
      console.log(`[DEBUG] NPC ${npcId} not found`);
      return;
    }
    
    console.log(`[DEBUG] NPC Equipment Status for ${npcId}:`);
    console.log(`  - isHumanNPC: ${npc.isHumanNPC}`);
    console.log(`  - loadoutId: ${npc.loadoutId}`);
    console.log(`  - currentLoadoutSlot: ${npc.currentLoadoutSlot}`);
    console.log(`  - gender: ${npc.gender}`);
    console.log(`  - headActor: ${npc.headActor}`);
    
    console.log(`  - Loadout items:`, Object.keys(npc._loadout || {}));
    console.log(`  - Equipment slots:`, Object.keys(npc._equipment || {}));
    
    // Check equipment slots
    if (npc._equipment) {
      Object.keys(npc._equipment).forEach(slotId => {
        const equipment = npc._equipment[slotId];
        console.log(`  - EquipSlot ${slotId}:`, {
          modelName: equipment.modelName,
          itemDefinitionId: equipment.itemDefinitionId,
          guid: equipment.guid
        });
      });
    }
    
    // Check loadout items and their durability
    if (npc._loadout) {
      Object.keys(npc._loadout).forEach(slotId => {
        const item = npc._loadout[slotId];
        console.log(`  - LoadoutSlot ${slotId}:`, {
          itemDefinitionId: item.itemDefinitionId,
          currentDurability: item.currentDurability,
          guid: item.itemGuid
        });
      });
    }
    
    // Check durability tracking
    if (npc._equipmentDurability) {
      console.log(`  - Durability tracking:`, npc._equipmentDurability);
    }
    
    console.log(`  - Empty loadout = NO death bag will be created`);
  }
}

module.exports = DestroMOD_AI_Plugin;