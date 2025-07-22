"use strict";

const ZombieAI = require('./zombieAI.js');
const HumanAI = require('./humanAI.js');

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
      name: "fix_npc",
      permissionLevel: 0,
      execute: (server, client, args) => {
        if (!args[0]) {
          server.sendChatText(client, "Usage: /fix_npc <npcId>");
          return;
        }
        this.fixNPCEquipment(server, args[0]);
        server.sendChatText(client, `Equipment fix attempted for NPC ${args[0]}`);
      }
    },
    {
      name: "spawn_manual",
      permissionLevel: 0,
      execute: (server, client, args) => {
        const npcId = this.createManualEquippedNPC(server, client);
        if (npcId) {
          server.sendChatText(client, `Manual equipped NPC spawned: ${npcId}`);
        } else {
          server.sendChatText(client, "Failed to spawn manual equipped NPC");
        }
      }
    },
    {
      name: "compare_equipment",
      permissionLevel: 0,
      execute: (server, client, args) => {
        if (!args[0]) {
          server.sendChatText(client, "Usage: /compare_equipment <npcId>");
          return;
        }
        this.compareEquipmentSystems(server, client.character.characterId, args[0]);
        server.sendChatText(client, `Equipment comparison logged`);
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
      name: "test_manual",
      permissionLevel: 0,
      execute: (server, client, args) => {
        console.log("[TEST] Manual equipment test starting...");
        server.sendChatText(client, "Testing manual equipment - check console");
        this.testManualEquipment(server, client);
      }
    },
    {
      name: "equip_all",
      permissionLevel: 0,
      execute: (server, client, args) => {
        this.equipAllHumanNPCs(server, client);
        server.sendChatText(client, "Attempting to equip all human NPCs with weapons");
      }
    },
    {
      name: "test_tracking",
      permissionLevel: 0,
      execute: (server, client, args) => {
        this.testEnhancedHeadTracking(server, client);
        server.sendChatText(client, "Enhanced head tracking applied to NPCs - check console");
      }
    },
    {
      name: "test_realistic",
      permissionLevel: 0,
      execute: (server, client, args) => {
        this.testRealisticHeadTracking(server, client);
        server.sendChatText(client, "Realistic head tracking - looks forward with comfort zone");
      }
    }
  ];

  attackCooldowns = new Map();
  shootCooldowns = new Map();
  config = {};

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
    this.hasSpawned = false; // Track if we've already spawned NPCs
  }

  loadConfig(config) {
    console.log(`[${this.name}] Loading configuration from destromod-config.yaml...`);
    this.config = config;
  }

  init(server) {
    console.log(`[${this.name}] Initializing AI`);
    this.zombieAI.startup(server);
    this.humanAI.startup(server);

    // Store reference on server
    server.destroMOD = this;

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

  // Simple auto-spawn system
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
        server.sendChatText(client, "✅ Spawned 1 human NPC with AK-47!");
        server.sendChatText(client, "Equipment will be applied when you're fully loaded");
        server.sendChatText(client, "Commands: /equip_all, /debug_npc <id>, /test_tracking");
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

  // Enhanced Human NPC Spawn Method (now using working manual approach)
  spawnHumanNPC(server, client) {
    try {
      console.log(`[${this.name}] Spawning human NPC with working equipment system...`);
      
      const characterId = server.generateGuid();
      const transient = server.getTransientId(characterId);
      
      // Spawn position slightly offset from player
      const spawnPos = [
        client.character.state.position[0] + 5,
        client.character.state.position[1],
        client.character.state.position[2] + 45,
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
      
      // Set up character properties for proper equipment rendering
      humanNpc.headActor = "SurvivorMale_Head_01.adr";
      humanNpc.gender = 1; // Male
      humanNpc.loadoutId = 5; // Character loadout
      humanNpc.currentLoadoutSlot = 1; // Primary weapon slot
      
      // Initialize equipment systems
      humanNpc._loadout = {};
      humanNpc._equipment = {};
      humanNpc._containers = {};
      
      // MANUAL EQUIPMENT SETUP (using the working method)
      const weaponGuid = server.generateGuid();
      const weaponDef = server.getItemDefinition(2229); // AK-47
      
      if (weaponDef) {
        console.log(`[${this.name}] Setting up AK-47 equipment...`);
        
        // Create loadout entry manually
        humanNpc._loadout[1] = {
          itemDefinitionId: 2229,
          itemGuid: weaponGuid,
          slotId: 1,
          stackCount: 1,
          currentDurability: 100,
          containerGuid: "0xFFFFFFFFFFFFFFFF",
          loadoutItemOwnerGuid: humanNpc.characterId
        };
        
        // Create equipment entry manually
        const equipmentSlotId = weaponDef.ACTIVE_EQUIP_SLOT_ID || 7;
        humanNpc._equipment[equipmentSlotId] = {
          modelName: weaponDef.MODEL_NAME || "Weapon_AK47_3P.adr",
          slotId: equipmentSlotId,
          guid: weaponGuid,
          textureAlias: weaponDef.TEXTURE_ALIAS || "Default",
          effectId: weaponDef.EFFECT_ID || 0,
          tintAlias: "Default",
          decalAlias: "#",
          SHADER_PARAMETER_GROUP: server.getShaderParameterGroup(2229) || []
        };
        
        console.log(`[${this.name}] Equipment data created for slot ${equipmentSlotId}`);
      }
      
      // Add to server first
      server._npcs[characterId] = humanNpc;
      server.aiManager.addEntity(humanNpc);
      
      // Store the NPC for delayed equipment setup
      humanNpc.needsEquipmentSetup = true;
      
      console.log(`[${this.name}] Human NPC ${characterId} spawned, equipment will be applied when player is ready`);
      return true;
      
    } catch (error) {
      console.error(`[${this.name}] Error spawning human NPC:`, error);
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
    
    // Check weapon in slot 1
    const weaponSlot = npc._loadout?.[1];
    if (weaponSlot) {
      console.log(`  - Weapon in slot 1:`, {
        itemDefinitionId: weaponSlot.itemDefinitionId,
        itemGuid: weaponSlot.itemGuid,
        slotId: weaponSlot.slotId
      });
    }
    
    // Check equipment slots
    for (const [slotId, equipment] of Object.entries(npc._equipment || {})) {
      console.log(`  - Equipment slot ${slotId}:`, {
        modelName: equipment.modelName,
        guid: equipment.guid,
        slotId: equipment.slotId
      });
    }
    
    // Get weapon definition info
    const weaponDef = server.getItemDefinition(2229);
    if (weaponDef) {
      console.log(`  - AK-47 Definition:`, {
        NAME_ID: weaponDef.NAME_ID,
        MODEL_NAME: weaponDef.MODEL_NAME,
        ACTIVE_EQUIP_SLOT_ID: weaponDef.ACTIVE_EQUIP_SLOT_ID,
        PASSIVE_EQUIP_SLOT_ID: weaponDef.PASSIVE_EQUIP_SLOT_ID,
        TEXTURE_ALIAS: weaponDef.TEXTURE_ALIAS,
        EFFECT_ID: weaponDef.EFFECT_ID
      });
    }
  }

  fixNPCEquipment(server, npcId) {
    const npc = server._npcs[npcId];
    if (!npc || !npc.isHumanNPC) {
      console.log(`[FIX] NPC ${npcId} not found or not human`);
      return;
    }
    
    console.log(`[FIX] Attempting to fix equipment for NPC ${npcId}`);
    
    // Re-run equipment generation
    if (typeof npc.generateEquipmentFromLoadout === 'function') {
      npc.generateEquipmentFromLoadout(server);
    }
    
    // Force equipment update
    if (typeof npc.updateEquipment === 'function') {
      npc.updateEquipment(server);
    }
    
    // Send individual slot updates
    for (const slotId of Object.keys(npc._equipment || {})) {
      if (typeof npc.updateEquipmentSlot === 'function') {
        npc.updateEquipmentSlot(server, parseInt(slotId));
      }
    }
    
    console.log(`[FIX] Equipment fix attempted for NPC ${npcId}`);
  }

  compareEquipmentSystems(server, playerId, npcId) {
    const player = server._characters[playerId];
    const npc = server._npcs[npcId];
    
    if (!player || !npc) {
      console.log(`[COMPARE] Player or NPC not found`);
      return;
    }
    
    console.log(`[COMPARE] Equipment System Comparison:`);
    
    console.log(`\nPLAYER ${playerId}:`);
    console.log(`  Loadout:`, Object.keys(player._loadout || {}));
    console.log(`  Equipment:`, Object.keys(player._equipment || {}));
    console.log(`  Current slot:`, player.currentLoadoutSlot);
    
    console.log(`\nNPC ${npcId}:`);
    console.log(`  Loadout:`, Object.keys(npc._loadout || {}));
    console.log(`  Equipment:`, Object.keys(npc._equipment || {}));
    console.log(`  Current slot:`, npc.currentLoadoutSlot);
    
    // Compare weapon in primary slot
    const playerWeapon = player._loadout?.[1];
    const npcWeapon = npc._loadout?.[1];
    
    if (playerWeapon && npcWeapon) {
      console.log(`\nWEAPON COMPARISON (Slot 1):`);
      console.log(`  Player weapon:`, {
        id: playerWeapon.itemDefinitionId,
        guid: playerWeapon.itemGuid,
        hasWeaponComponent: !!playerWeapon.weapon
      });
      console.log(`  NPC weapon:`, {
        id: npcWeapon.itemDefinitionId,
        guid: npcWeapon.itemGuid,
        hasWeaponComponent: !!npcWeapon.weapon
      });
    }
  }

  testManualEquipment(server, client) {
    // Find ALL NPCs, not just human ones
    const allNpcs = Object.keys(server._npcs);
    console.log(`[TEST] Found ${allNpcs.length} total NPCs`);
    
    // Look for NPCs that might be human but not flagged properly
    const potentialHumanNpcs = allNpcs.filter(id => {
      const npc = server._npcs[id];
      return npc.actorModelId === 9469; // SURVIVOR_MALE_HEAD_01
    });
    
    console.log(`[TEST] Found ${potentialHumanNpcs.length} potential human NPCs (model 9469)`);
    
    if (potentialHumanNpcs.length === 0) {
      console.log("[TEST] No human-model NPCs found");
      return;
    }
    
    const npcId = potentialHumanNpcs[0];
    const npc = server._npcs[npcId];
    
    console.log(`[TEST] Testing equipment on NPC ${npcId}`);
    console.log(`[TEST] NPC current state:`, {
      loadout: Object.keys(npc._loadout || {}),
      equipment: Object.keys(npc._equipment || {}),
      isHumanNPC: npc.isHumanNPC,
      actorModelId: npc.actorModelId,
      health: npc.health
    });
    
    // Fix the NPC if it's not properly flagged
    if (!npc.isHumanNPC) {
      console.log(`[TEST] Fixing NPC ${npcId} - setting isHumanNPC = true`);
      npc.isHumanNPC = true;
      npc.weapon = 2229; // AK-47
      npc.gender = 1;
      npc.loadoutId = 5;
      npc.currentLoadoutSlot = 1;
    }
    
    // Try to manually add equipment
    const weaponGuid = server.generateGuid();
    const weaponDef = server.getItemDefinition(2229);
    
    if (weaponDef) {
      console.log(`[TEST] Adding equipment manually to existing NPC...`);
      
      // Initialize if needed
      if (!npc._loadout) npc._loadout = {};
      if (!npc._equipment) npc._equipment = {};
      
      // Add to loadout
      npc._loadout[1] = {
        itemDefinitionId: 2229,
        itemGuid: weaponGuid,
        slotId: 1,
        stackCount: 1,
        currentDurability: 100,
        containerGuid: "0xFFFFFFFFFFFFFFFF",
        loadoutItemOwnerGuid: npc.characterId
      };
      
      // Add to equipment
      const equipSlotId = weaponDef.ACTIVE_EQUIP_SLOT_ID || 7;
      npc._equipment[equipSlotId] = {
        modelName: weaponDef.MODEL_NAME,
        slotId: equipSlotId,
        guid: weaponGuid,
        textureAlias: weaponDef.TEXTURE_ALIAS || "Default",
        effectId: weaponDef.EFFECT_ID || 0,
        tintAlias: "Default",
        decalAlias: "#",
        SHADER_PARAMETER_GROUP: server.getShaderParameterGroup(2229) || []
      };
      
      console.log(`[TEST] Equipment added to existing NPC:`, {
        loadoutSlots: Object.keys(npc._loadout),
        equipmentSlots: Object.keys(npc._equipment),
        weaponGuid: weaponGuid,
        equipSlotId: equipSlotId
      });
      
      // Try to send the packets
      setTimeout(() => {
        console.log(`[TEST] Sending equipment packets to existing NPC...`);
        
        try {
          // Try manual packet sending
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
              equipmentSlots: [{
                equipmentSlotId: equipSlotId,
                equipmentSlotData: {
                  equipmentSlotId: equipSlotId,
                  guid: weaponGuid,
                  effectId: 0,
                  tintAlias: "Default",
                  decalAlias: "#"
                }
              }],
              attachmentData: [{
                modelName: weaponDef.MODEL_NAME,
                effectId: 0,
                textureAlias: weaponDef.TEXTURE_ALIAS || "Default",
                tintAlias: "Default",
                decalAlias: "#",
                slotId: equipSlotId,
                SHADER_PARAMETER_GROUP: server.getShaderParameterGroup(2229) || []
              }],
              unknownBoolean1: true
            }
          );
          
          console.log(`[TEST] Manual equipment packet sent to existing NPC`);
          
        } catch (error) {
          console.log(`[TEST] Error sending equipment:`, error);
        }
        
        // Debug result
        setTimeout(() => {
          console.log(`[TEST] Final state after equipment addition:`, {
            loadout: Object.keys(npc._loadout || {}),
            equipment: Object.keys(npc._equipment || {}),
            isHumanNPC: npc.isHumanNPC
          });
        }, 1000);
        
      }, 2000);
    }
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
      
      // Set up equipment
      const weaponGuid = server.generateGuid();
      const weaponDef = server.getItemDefinition(2229);
      
      if (weaponDef) {
        // Initialize if needed
        if (!npc._loadout) npc._loadout = {};
        if (!npc._equipment) npc._equipment = {};
        
        // Add to loadout
        npc._loadout[1] = {
          itemDefinitionId: 2229,
          itemGuid: weaponGuid,
          slotId: 1,
          stackCount: 1,
          currentDurability: 100,
          containerGuid: "0xFFFFFFFFFFFFFFFF",
          loadoutItemOwnerGuid: npc.characterId
        };
        
        // Add to equipment
        const equipSlotId = weaponDef.ACTIVE_EQUIP_SLOT_ID || 7;
        npc._equipment[equipSlotId] = {
          modelName: weaponDef.MODEL_NAME,
          slotId: equipSlotId,
          guid: weaponGuid,
          textureAlias: weaponDef.TEXTURE_ALIAS || "Default",
          effectId: weaponDef.EFFECT_ID || 0,
          tintAlias: "Default",
          decalAlias: "#",
          SHADER_PARAMETER_GROUP: server.getShaderParameterGroup(2229) || []
        };
        
        // Send equipment packets with staggered timing
        setTimeout(() => {
          try {
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
                equipmentSlots: [{
                  equipmentSlotId: equipSlotId,
                  equipmentSlotData: {
                    equipmentSlotId: equipSlotId,
                    guid: weaponGuid,
                    effectId: 0,
                    tintAlias: "Default",
                    decalAlias: "#"
                  }
                }],
                attachmentData: [{
                  modelName: weaponDef.MODEL_NAME,
                  effectId: 0,
                  textureAlias: weaponDef.TEXTURE_ALIAS || "Default",
                  tintAlias: "Default",
                  decalAlias: "#",
                  slotId: equipSlotId,
                  SHADER_PARAMETER_GROUP: server.getShaderParameterGroup(2229) || []
                }],
                unknownBoolean1: true
              }
            );
            
            console.log(`[EQUIP_ALL] Equipment packet sent for NPC ${npcId}`);
            
          } catch (error) {
            console.log(`[EQUIP_ALL] Error equipping NPC ${npcId}:`, error);
          }
        }, index * 500); // Stagger by 500ms each
      }
    });
  }

  testEnhancedHeadTracking(server, client) {
    console.log(`[HEAD_TRACKING] Testing enhanced head tracking...`);
    
    // Find all human NPCs
    const humanNpcs = Object.keys(server._npcs).filter(id => {
      const npc = server._npcs[id];
      return npc.actorModelId === 9469 && npc.isHumanNPC;
    });
    
    if (humanNpcs.length === 0) {
      console.log(`[HEAD_TRACKING] No human NPCs found to test`);
      return;
    }
    
    console.log(`[HEAD_TRACKING] Found ${humanNpcs.length} human NPCs, applying enhanced tracking...`);
    
    humanNpcs.forEach((npcId, index) => {
      const npc = server._npcs[npcId];
      
      // Patch the NPC's faceTarget method with enhanced version
      npc.enhancedFaceTarget = (target) => {
        const dirX = target.state.position[0] - npc.state.position[0];
        const dirZ = target.state.position[2] - npc.state.position[2];
        const dirY = target.state.position[1] - npc.state.position[1];
        
        // Calculate horizontal orientation (body rotation)
        const orientation = Math.atan2(dirX, dirZ);
        
        // Calculate pitch for head tracking (looking up/down)
        const horizontalDistance = Math.sqrt(dirX * dirX + dirZ * dirZ);
        const pitch = Math.atan2(dirY, horizontalDistance);
        
        // Send enhanced position update with lookAt
        this.sendEnhancedMovementPacket(npc, target, orientation);
        
        console.log(`[HEAD_TRACKING] NPC ${npcId} enhanced tracking: orientation=${orientation.toFixed(2)}, pitch=${pitch.toFixed(2)}`);
      };
      
      // Patch the humanAI's faceTarget method for this NPC
      const humanAI = server.destroMOD.humanAI;
      const originalFaceTarget = humanAI.faceTarget.bind(humanAI);
      
      // Override faceTarget specifically for this NPC
      const enhancedFaceTarget = (npcToFace, target) => {
        if (npcToFace.characterId === npc.characterId) {
          // Use enhanced tracking for this NPC
          npc.enhancedFaceTarget(target);
        } else {
          // Use original method for other NPCs
          originalFaceTarget(npcToFace, target);
        }
      };
      
      // Store the original method and replace it
      if (!humanAI.originalFaceTarget) {
        humanAI.originalFaceTarget = humanAI.faceTarget;
      }
      humanAI.faceTarget = enhancedFaceTarget;
      
      console.log(`[HEAD_TRACKING] Enhanced tracking applied to NPC ${index + 1}/${humanNpcs.length}: ${npcId}`);
    });
    
    console.log(`[HEAD_TRACKING] Enhanced head tracking is now active. Test by getting close to NPCs.`);
  }

  sendEnhancedMovementPacket(npc, target, orientation) {
    try {
      const path = require('path');
      const { getCurrentServerTimeWrapper } = require(path.join(process.cwd(), 'node_modules/h1z1-server/out/utils/utils'));
      
      // Enhanced position update with proper lookAt vector
      npc.server.sendDataToAllWithSpawnedEntity(
        npc.server._npcs,
        npc.characterId,
        "PlayerUpdatePosition",
        {
          transientId: npc.transientId,
          positionUpdate: {
            sequenceTime: getCurrentServerTimeWrapper().getTruncatedU32(),
            position: npc.state.position,
            unknown3_int8: 0,
            stance: 66565,
            engineRPM: 0,
            orientation: orientation,
            frontTilt: 0,
            sideTilt: 0,
            angleChange: 0,
            verticalSpeed: 0,
            horizontalSpeed: 0
          }
        }
      );
      
      // Try to send a Character.UpdateLookAt packet for head tracking
      setTimeout(() => {
        try {
          npc.server.sendDataToAllWithSpawnedEntity(
            npc.server._npcs,
            npc.characterId,
            "Character.UpdateCharacterState",
            {
              characterId: npc.characterId,
              states1: 0,
              states2: 0,
              gameTime: getCurrentServerTimeWrapper().getTruncatedU32()
            }
          );
          
          // Alternative: Try a lookAt update
          npc.state.lookAt = [
            target.state.position[0],
            target.state.position[1] + 1.5, // Head height
            target.state.position[2],
            1
          ];
          
        } catch (error) {
          console.log(`[HEAD_TRACKING] Error sending lookAt update:`, error.message);
        }
      }, 50); // Small delay
      
    } catch (error) {
      console.log(`[HEAD_TRACKING] Error in enhanced movement:`, error.message);
    }
  }

  testSmoothHeadTracking(server, client) {
    console.log(`[SMOOTH_TRACKING] Testing smooth head tracking...`);
    
    // Find all human NPCs
    const humanNpcs = Object.keys(server._npcs).filter(id => {
      const npc = server._npcs[id];
      return npc.actorModelId === 9469 && npc.isHumanNPC;
    });
    
    if (humanNpcs.length === 0) {
      console.log(`[SMOOTH_TRACKING] No human NPCs found to test`);
      return;
    }
    
    console.log(`[SMOOTH_TRACKING] Found ${humanNpcs.length} human NPCs, applying smooth tracking...`);
    
    humanNpcs.forEach((npcId, index) => {
      const npc = server._npcs[npcId];
      
      // Initialize tracking state
      npc.lastOrientation = npc.state.orientation || 0;
      npc.lastTrackingUpdate = 0;
      
      // Smooth face target method
      npc.smoothFaceTarget = (target) => {
        const now = Date.now();
        
        // Limit update frequency to reduce jitter
        if (now - npc.lastTrackingUpdate < 500) { // Update every 500ms max
          return;
        }
        npc.lastTrackingUpdate = now;
        
        const dirX = target.state.position[0] - npc.state.position[0];
        const dirZ = target.state.position[2] - npc.state.position[2];
        
        // Calculate target orientation
        const targetOrientation = Math.atan2(dirX, dirZ);
        
        // Smooth interpolation toward target
        const angleDiff = this.getAngleDifference(npc.lastOrientation, targetOrientation);
        const maxRotationSpeed = 0.1; // Radians per update (slower = smoother)
        
        let newOrientation;
        if (Math.abs(angleDiff) <= maxRotationSpeed) {
          newOrientation = targetOrientation; // Close enough, snap to target
        } else {
          // Smooth rotation toward target
          newOrientation = npc.lastOrientation + (angleDiff > 0 ? maxRotationSpeed : -maxRotationSpeed);
        }
        
        // Normalize orientation
        newOrientation = this.normalizeAngle(newOrientation);
        npc.lastOrientation = newOrientation;
        
        // Send smooth movement update
        this.sendSmoothMovementPacket(npc, newOrientation);
        
        console.log(`[SMOOTH_TRACKING] NPC ${npcId} smooth rotation: ${newOrientation.toFixed(2)} (diff: ${angleDiff.toFixed(2)})`);
      };
      
      // Override the humanAI faceTarget for this NPC
      const humanAI = server.destroMOD.humanAI;
      if (!humanAI.originalFaceTarget) {
        humanAI.originalFaceTarget = humanAI.faceTarget;
      }
      
      const smoothFaceTarget = (npcToFace, target) => {
        if (npcToFace.characterId === npc.characterId) {
          npc.smoothFaceTarget(target);
        } else {
          humanAI.originalFaceTarget(npcToFace, target);
        }
      };
      
      humanAI.faceTarget = smoothFaceTarget;
      
      console.log(`[SMOOTH_TRACKING] Smooth tracking applied to NPC ${index + 1}/${humanNpcs.length}: ${npcId}`);
    });
    
    console.log(`[SMOOTH_TRACKING] Smooth head tracking is now active. NPCs should look at you more naturally.`);
  }

  getAngleDifference(current, target) {
    let diff = target - current;
    
    // Normalize to [-π, π]
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    
    return diff;
  }

  normalizeAngle(angle) {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
  }

  sendSmoothMovementPacket(npc, orientation) {
    try {
      const path = require('path');
      const { getCurrentServerTimeWrapper } = require(path.join(process.cwd(), 'node_modules/h1z1-server/out/utils/utils'));
      
      npc.state.orientation = orientation;
      
      npc.server.sendDataToAllWithSpawnedEntity(
        npc.server._npcs,
        npc.characterId,
        "PlayerUpdatePosition",
        {
          transientId: npc.transientId,
          positionUpdate: {
            sequenceTime: getCurrentServerTimeWrapper().getTruncatedU32(),
            position: npc.state.position,
            unknown3_int8: 0,
            stance: 66565,
            engineRPM: 0,
            orientation: orientation,
            frontTilt: 0,
            sideTilt: 0,
            angleChange: 0,
            verticalSpeed: 0,
            horizontalSpeed: 0
          }
        }
      );
      
    } catch (error) {
      console.log(`[SMOOTH_TRACKING] Error in smooth movement:`, error.message);
    }
  }

  testSmartHeadTracking(server, client) {
    console.log(`[SMART_TRACKING] Testing smart adaptive head tracking...`);
    
    // Find all human NPCs
    const humanNpcs = Object.keys(server._npcs).filter(id => {
      const npc = server._npcs[id];
      return npc.actorModelId === 9469 && npc.isHumanNPC;
    });
    
    if (humanNpcs.length === 0) {
      console.log(`[SMART_TRACKING] No human NPCs found to test`);
      return;
    }
    
    console.log(`[SMART_TRACKING] Found ${humanNpcs.length} human NPCs, applying smart tracking...`);
    
    humanNpcs.forEach((npcId, index) => {
      const npc = server._npcs[npcId];
      
      // Initialize smart tracking state
      npc.lastOrientation = npc.state.orientation || 0;
      npc.lastTrackingUpdate = 0;
      npc.lastPlayerPosition = null;
      npc.trackingDeadZone = 0.05; // Don't update for tiny movements
      
      // Smart adaptive face target method
      npc.smartFaceTarget = (target) => {
        const now = Date.now();
        
        // Calculate target direction at ground level (not head level)
        const targetGroundPos = [
          target.state.position[0],
          npc.state.position[1], // Same Y level as NPC - fixes "looking too high"
          target.state.position[2]
        ];
        
        const dirX = targetGroundPos[0] - npc.state.position[0];
        const dirZ = targetGroundPos[2] - npc.state.position[2];
        const distance = Math.sqrt(dirX * dirX + dirZ * dirZ);
        
        // Don't track if too close (prevents crazy spinning)
        if (distance < 2.0) {
          return;
        }
        
        const targetOrientation = Math.atan2(dirX, dirZ);
        const angleDiff = this.getAngleDifference(npc.lastOrientation, targetOrientation);
        
        // Dead zone - ignore tiny movements
        if (Math.abs(angleDiff) < npc.trackingDeadZone) {
          return;
        }
        
        // Adaptive rotation speed based on angle difference
        let rotationSpeed;
        if (Math.abs(angleDiff) > 1.5) {
          rotationSpeed = 0.3; // Fast for large angles
        } else if (Math.abs(angleDiff) > 0.5) {
          rotationSpeed = 0.15; // Medium for moderate angles
        } else {
          rotationSpeed = 0.08; // Slow for fine adjustments
        }
        
        // Update frequency based on movement speed
        let updateInterval;
        if (Math.abs(angleDiff) > 1.0) {
          updateInterval = 200; // Fast updates for rapid movement
        } else {
          updateInterval = 400; // Slower for fine tracking
        }
        
        // Check if enough time has passed
        if (now - npc.lastTrackingUpdate < updateInterval) {
          return;
        }
        npc.lastTrackingUpdate = now;
        
        // Calculate new orientation
        let newOrientation;
        if (Math.abs(angleDiff) <= rotationSpeed) {
          newOrientation = targetOrientation; // Snap if close
        } else {
          newOrientation = npc.lastOrientation + (angleDiff > 0 ? rotationSpeed : -rotationSpeed);
        }
        
        newOrientation = this.normalizeAngle(newOrientation);
        npc.lastOrientation = newOrientation;
        
        // Send update
        this.sendSmoothMovementPacket(npc, newOrientation);
        
        console.log(`[SMART_TRACKING] NPC ${npcId}: angle=${newOrientation.toFixed(2)}, diff=${angleDiff.toFixed(2)}, speed=${rotationSpeed.toFixed(2)}, dist=${distance.toFixed(1)}`);
      };
      
      // Override the humanAI faceTarget for this NPC
      const humanAI = server.destroMOD.humanAI;
      if (!humanAI.originalFaceTarget) {
        humanAI.originalFaceTarget = humanAI.faceTarget;
      }
      
      const smartFaceTarget = (npcToFace, target) => {
        if (npcToFace.characterId === npc.characterId) {
          npcToFace.smartFaceTarget(target);
        } else {
          humanAI.originalFaceTarget(npcToFace, target);
        }
      };
      
      humanAI.faceTarget = smartFaceTarget;
      
      console.log(`[SMART_TRACKING] Smart tracking applied to NPC ${index + 1}/${humanNpcs.length}: ${npcId}`);
    });
    
    console.log(`[SMART_TRACKING] Smart head tracking active. NPCs adapt to your movement speed and won't look too high.`);
  }

  testRealisticHeadTracking(server, client) {
    console.log(`[REALISTIC_TRACKING] Testing realistic forward-focused head tracking...`);
    
    // Find all human NPCs
    const humanNpcs = Object.keys(server._npcs).filter(id => {
      const npc = server._npcs[id];
      return npc.actorModelId === 9469 && npc.isHumanNPC;
    });
    
    if (humanNpcs.length === 0) {
      console.log(`[REALISTIC_TRACKING] No human NPCs found to test`);
      return;
    }
    
    console.log(`[REALISTIC_TRACKING] Found ${humanNpcs.length} human NPCs, applying realistic tracking...`);
    
    humanNpcs.forEach((npcId, index) => {
      const npc = server._npcs[npcId];
      
      // Initialize realistic tracking state
      npc.currentFacingDirection = npc.state.orientation || 0;
      npc.targetDirection = npc.currentFacingDirection;
      npc.lastTrackingUpdate = 0;
      npc.isInComfortZone = false;
      
      // Realistic tracking parameters
      npc.comfortZoneAngle = 0.3; // ~17 degrees - won't turn head for small movements
      npc.maxHeadTurnAngle = 1.2; // ~70 degrees - won't turn head more than this
      npc.updateInterval = 800; // Slower, more realistic updates
      
      // Realistic face target method
      npc.realisticFaceTarget = (target) => {
        const now = Date.now();
        
        // Don't update too frequently (realistic humans don't track every millisecond)
        if (now - npc.lastTrackingUpdate < npc.updateInterval) {
          return;
        }
        
        // Calculate target direction at same level
        const dirX = target.state.position[0] - npc.state.position[0];
        const dirZ = target.state.position[2] - npc.state.position[2];
        const distance = Math.sqrt(dirX * dirX + dirZ * dirZ);
        
        // Don't track if too close or too far
        if (distance < 3.0 || distance > 30.0) {
          return;
        }
        
        const targetDirection = Math.atan2(dirX, dirZ);
        const currentDirection = npc.currentFacingDirection;
        const angleDiff = this.getAngleDifference(currentDirection, targetDirection);
        
        // Check if target is within comfort zone
        const wasInComfortZone = npc.isInComfortZone;
        npc.isInComfortZone = Math.abs(angleDiff) <= npc.comfortZoneAngle;
        
        // Only update if target moves outside comfort zone OR we need to return to center
        let shouldUpdate = false;
        let newTargetDirection = currentDirection;
        
        if (!npc.isInComfortZone) {
          // Target is outside comfort zone - need to turn
          if (Math.abs(angleDiff) <= npc.maxHeadTurnAngle) {
            // Within max turn range - track the target
            newTargetDirection = targetDirection;
            shouldUpdate = true;
          } else {
            // Beyond max turn range - turn as far as we can
            newTargetDirection = currentDirection + (angleDiff > 0 ? npc.maxHeadTurnAngle : -npc.maxHeadTurnAngle);
            shouldUpdate = true;
          }
        } else if (wasInComfortZone !== npc.isInComfortZone) {
          // Just entered comfort zone - small adjustment to center on target
          newTargetDirection = targetDirection;
          shouldUpdate = true;
        }
        
        if (!shouldUpdate) {
          return; // Stay put - target is in comfort zone
        }
        
        npc.lastTrackingUpdate = now;
        
        // Smooth movement toward new target direction
        const targetDiff = this.getAngleDifference(currentDirection, newTargetDirection);
        const rotationSpeed = 0.12; // Slower, more realistic rotation
        
        let newDirection;
        if (Math.abs(targetDiff) <= rotationSpeed) {
          newDirection = newTargetDirection; // Close enough
        } else {
          newDirection = currentDirection + (targetDiff > 0 ? rotationSpeed : -rotationSpeed);
        }
        
        newDirection = this.normalizeAngle(newDirection);
        npc.currentFacingDirection = newDirection;
        npc.targetDirection = newTargetDirection;
        
        // Send update
        this.sendSmoothMovementPacket(npc, newDirection);
        
        const status = npc.isInComfortZone ? "COMFORT" : "TRACKING";
        console.log(`[REALISTIC_TRACKING] NPC ${npcId}: ${status} facing=${newDirection.toFixed(2)}, target_diff=${targetDiff.toFixed(2)}, dist=${distance.toFixed(1)}`);
      };
      
      // Override the humanAI faceTarget for this NPC
      const humanAI = server.destroMOD.humanAI;
      if (!humanAI.originalFaceTarget) {
        humanAI.originalFaceTarget = humanAI.faceTarget;
      }
      
      const realisticFaceTarget = (npcToFace, target) => {
        if (npcToFace.characterId === npc.characterId) {
          npcToFace.realisticFaceTarget(target);
        } else {
          humanAI.originalFaceTarget(npcToFace, target);
        }
      };
      
      humanAI.faceTarget = realisticFaceTarget;
      
      console.log(`[REALISTIC_TRACKING] Realistic tracking applied to NPC ${index + 1}/${humanNpcs.length}: ${npcId}`);
      console.log(`  - Comfort zone: ±${(npc.comfortZoneAngle * 180 / Math.PI).toFixed(0)}°`);
      console.log(`  - Max head turn: ±${(npc.maxHeadTurnAngle * 180 / Math.PI).toFixed(0)}°`);
    });
    
    console.log(`[REALISTIC_TRACKING] Realistic head tracking active. NPCs will look forward with occasional adjustments.`);
  }

  createManualEquippedNPC(server, client) {
    try {
      console.log(`[MANUAL] Creating manually equipped NPC...`);
      
      const characterId = server.generateGuid();
      const transient = server.getTransientId(characterId);
      
      // Spawn position
      const spawnPos = [
        client.character.state.position[0] - 10,
        client.character.state.position[1],
        client.character.state.position[2] + 10,
        1
      ];
      
      const path = require('path');
      const { Npc } = require(path.join(process.cwd(), 'node_modules/h1z1-server/out/servers/ZoneServer2016/entities/npc'));
      
      // Create NPC
      const humanNpc = new Npc(
        characterId,
        transient,
        9469, // SURVIVOR_MALE_HEAD_01
        spawnPos,
        client.character.state.rotation,
        server
      );
      
      // Configure as human
      humanNpc.isHumanNPC = true;
      humanNpc.health = 8000;
      humanNpc.maxHealth = 8000;
      humanNpc.headActor = "SurvivorMale_Head_01.adr";
      humanNpc.gender = 1;
      humanNpc.loadoutId = 5;
      humanNpc.currentLoadoutSlot = 1;
      
      // Initialize systems
      humanNpc._loadout = {};
      humanNpc._equipment = {};
      humanNpc._containers = {};
      
      // MANUAL EQUIPMENT SETUP - No dependencies
      const weaponGuid = server.generateGuid();
      const weaponDef = server.getItemDefinition(2229); // AK-47
      
      if (weaponDef) {
        console.log(`[MANUAL] Setting up weapon manually...`);
        
        // Create loadout entry manually
        humanNpc._loadout[1] = {
          itemDefinitionId: 2229,
          itemGuid: weaponGuid,
          slotId: 1,
          stackCount: 1,
          currentDurability: 100,
          containerGuid: "0xFFFFFFFFFFFFFFFF",
          loadoutItemOwnerGuid: humanNpc.characterId
        };
        
        // Create equipment entry manually
        const equipmentSlotId = weaponDef.ACTIVE_EQUIP_SLOT_ID || 7;
        humanNpc._equipment[equipmentSlotId] = {
          modelName: weaponDef.MODEL_NAME || "Weapon_AK47_3P.adr",
          slotId: equipmentSlotId,
          guid: weaponGuid,
          textureAlias: weaponDef.TEXTURE_ALIAS || "Default",
          effectId: weaponDef.EFFECT_ID || 0,
          tintAlias: "Default",
          decalAlias: "#",
          SHADER_PARAMETER_GROUP: server.getShaderParameterGroup(2229) || []
        };
        
        console.log(`[MANUAL] Manual equipment data created:`, {
          loadoutSlot: 1,
          equipmentSlot: equipmentSlotId,
          modelName: humanNpc._equipment[equipmentSlotId].modelName,
          guid: weaponGuid
        });
      }
      
      // Add to server
      server._npcs[characterId] = humanNpc;
      server.aiManager.addEntity(humanNpc);
      
      // Send all equipment packets manually after delay
      setTimeout(() => {
        console.log(`[MANUAL] Sending equipment packets...`);
        
        try {
          // Send equipment packet
          server.sendDataToAllWithSpawnedEntity(
            server._npcs,
            characterId,
            "Equipment.SetCharacterEquipment",
            {
              characterData: {
                profileId: 5,
                characterId: characterId
              },
              unknownDword1: 0,
              tintAlias: "Default",
              decalAlias: "#",
              equipmentSlots: Object.keys(humanNpc._equipment).map(slotId => ({
                equipmentSlotId: parseInt(slotId),
                equipmentSlotData: {
                  equipmentSlotId: parseInt(slotId),
                  guid: humanNpc._equipment[slotId].guid,
                  effectId: humanNpc._equipment[slotId].effectId,
                  tintAlias: humanNpc._equipment[slotId].tintAlias,
                  decalAlias: humanNpc._equipment[slotId].decalAlias
                }
              })),
              attachmentData: Object.keys(humanNpc._equipment).map(slotId => ({
                modelName: humanNpc._equipment[slotId].modelName,
                effectId: humanNpc._equipment[slotId].effectId,
                textureAlias: humanNpc._equipment[slotId].textureAlias,
                tintAlias: humanNpc._equipment[slotId].tintAlias,
                decalAlias: humanNpc._equipment[slotId].decalAlias,
                slotId: parseInt(slotId),
                SHADER_PARAMETER_GROUP: humanNpc._equipment[slotId].SHADER_PARAMETER_GROUP
              })),
              unknownBoolean1: true
            }
          );
          
          // Send loadout packet
          server.sendDataToAllWithSpawnedEntity(
            server._npcs,
            characterId,
            "Loadout.SetLoadoutSlots",
            {
              characterId: characterId,
              loadoutId: 5,
              loadoutData: {
                loadoutSlots: Object.keys(humanNpc._loadout).map(slotId => ({
                  hotbarSlotId: parseInt(slotId),
                  loadoutId: 5,
                  slotId: parseInt(slotId),
                  loadoutItemData: {
                    itemDefinitionId: humanNpc._loadout[slotId].itemDefinitionId,
                    loadoutItemGuid: humanNpc._loadout[slotId].itemGuid,
                    unknownByte1: 255
                  },
                  unknownDword1: parseInt(slotId)
                }))
              },
              currentSlotId: 1
            }
          );
          
          console.log(`[MANUAL] Equipment packets sent successfully`);
          
        } catch (error) {
          console.log(`[MANUAL] Error sending equipment packets:`, error);
        }
        
        // Debug after a moment
        setTimeout(() => {
          this.debugNPCEquipment(server, characterId);
        }, 1000);
        
      }, 3000);
      
      return characterId;
      
    } catch (error) {
      console.error(`[MANUAL] Error creating manual equipped NPC:`, error);
      return null;
    }
  }
}

module.exports = DestroMOD_AI_Plugin;