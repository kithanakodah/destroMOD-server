// armorDamage.js - Armor Durability System for destroMOD
// This works with the existing damageItem function in zoneserver.ts
"use strict";

class ArmorDamageSystem {
  constructor(plugin) {
    this.plugin = plugin;
    this.name = "ArmorDamageSystem";
    this.isPatched = false;
  }

  // Initialize the armor damage system
  init(server) {
    console.log(`[${this.name}] Initializing armor damage system...`);
    
    // Store reference to server
    this.server = server;
    
    // The server already has damageItem - we just need to verify it's working
    this.debugExistingDamageSystem(server);
    
    // Add our debug helpers to the server
    server.debugArmorStatus = this.debugArmorStatus.bind(this);
    server.testArmorDamage = this.testArmorDamage.bind(this);
    
    console.log(`[${this.name}] Armor damage system initialized - using existing damageItem function`);
  }

  // Debug the existing damage system to see what's happening
  debugExistingDamageSystem(server) {
    console.log(`[${this.name}] Analyzing existing damageItem function...`);
    
    // Check if the server has the expected methods
    const hasDamageItem = typeof server.damageItem === 'function';
    const hasUpdateItem = typeof server.updateItem === 'function';
    const hasGetClientByCharId = typeof server.getClientByCharId === 'function';
    const hasApplyArmorDamageReduction = typeof server.applyArmorDamageReduction === 'function';
    const hasApplyHelmetDamageReduction = typeof server.applyHelmetDamageReduction === 'function';
    
    console.log(`[${this.name}] Server method check:`);
    console.log(`  - damageItem: ${hasDamageItem}`);
    console.log(`  - updateItem: ${hasUpdateItem}`);
    console.log(`  - getClientByCharId: ${hasGetClientByCharId}`);
    console.log(`  - applyArmorDamageReduction: ${hasApplyArmorDamageReduction}`);
    console.log(`  - applyHelmetDamageReduction: ${hasApplyHelmetDamageReduction}`);
    
    if (!hasDamageItem) {
      console.error(`[${this.name}] ERROR: server.damageItem function not found!`);
      return;
    }
    
    // Wrap the existing damageItem function to add debug logging
    if (!server._originalDamageItem) {
      server._originalDamageItem = server.damageItem.bind(server);
      
      server.damageItem = function(character, item, damage) {
  // Get item definition to check if it's a weapon
  const itemDef = server.getItemDefinition(item.itemDefinitionId);
  const isWeapon = itemDef && (
    itemDef.ITEM_CLASS === 31 || // Weapon class
    itemDef.ITEM_TYPE === 10 ||  // Weapon type
    itemDef.NAME?.toLowerCase().includes('weapon') ||
    itemDef.NAME?.toLowerCase().includes('rifle') ||
    itemDef.NAME?.toLowerCase().includes('pistol') ||
    itemDef.NAME?.toLowerCase().includes('shotgun') ||
    itemDef.NAME?.toLowerCase().includes('sniper')
  );
  
  // Only log non-weapon durability damage (armor, helmets, tools, etc.)
  if (!isWeapon) {
    console.log(`[ArmorDamageSystem] DAMAGE_ITEM_DEBUG:`);
    console.log(`  - Character ID: ${character.characterId}`);
    console.log(`  - Item ID: ${item.itemDefinitionId}`);
    console.log(`  - Current Durability: ${item.currentDurability}`);
    console.log(`  - Damage Amount: ${damage}`);
    console.log(`  - Is Human NPC: ${character.isHumanNPC}`);
  }
        
        // Call the original function
        const result = server._originalDamageItem(character, item, damage);
        
        console.log(`  - New Durability: ${item.currentDurability}`);
        console.log(`  - Item removed: ${item.currentDurability <= 0}`);
        
        // Check if client was found for update
        const client = server.getClientByCharId(character.characterId);
        console.log(`  - Client found for update: ${!!client}`);
        
        // For NPCs, update durability tracking manually since no client update happens
        if (character.isHumanNPC && character._equipmentDurability && item.currentDurability > 0) {
          character._equipmentDurability[item.itemDefinitionId] = item.currentDurability;
          console.log(`  - Updated NPC durability tracking: ${item.itemDefinitionId} -> ${item.currentDurability}`);
        }
        
        return result;
      };
      
      console.log(`[${this.name}] Wrapped existing damageItem function with debug logging`);
    }
    
    // CRITICAL: Also wrap the armor damage reduction functions to see if they're being called
    if (!server._originalApplyArmorDamageReduction && hasApplyArmorDamageReduction) {
      server._originalApplyArmorDamageReduction = server.applyArmorDamageReduction.bind(server);
      
      server.applyArmorDamageReduction = function(character, damage, weaponDmgModifier = 4) {
        console.log(`[ArmorDamageSystem] APPLY_ARMOR_DAMAGE_REDUCTION_DEBUG:`);
        console.log(`  - Character ID: ${character.characterId}`);
        console.log(`  - Is Human NPC: ${character.isHumanNPC}`);
        console.log(`  - Incoming Damage: ${damage}`);
        console.log(`  - Weapon Damage Modifier: ${weaponDmgModifier}`);
        
        // Check if character has armor
        const armorSlot = character._loadout && character._loadout[38];
        if (armorSlot) {
          console.log(`  - Has Armor: YES (ID: ${armorSlot.itemDefinitionId}, Durability: ${armorSlot.currentDurability})`);
        } else {
          console.log(`  - Has Armor: NO`);
        }
        
        // Call the original function
        const result = server._originalApplyArmorDamageReduction(character, damage, weaponDmgModifier);
        
        console.log(`  - Reduced Damage: ${result}`);
        
        // Check armor durability after damage
        if (armorSlot) {
          console.log(`  - Armor Durability After: ${armorSlot.currentDurability}`);
        }
        
        return result;
      };
      
      console.log(`[${this.name}] Wrapped applyArmorDamageReduction function with debug logging`);
    }
    
    // Also wrap helmet damage reduction
    if (!server._originalApplyHelmetDamageReduction && hasApplyHelmetDamageReduction) {
      server._originalApplyHelmetDamageReduction = server.applyHelmetDamageReduction.bind(server);
      
      server.applyHelmetDamageReduction = function(character, damage, weaponDmgModifier = 1) {
        console.log(`[ArmorDamageSystem] APPLY_HELMET_DAMAGE_REDUCTION_DEBUG:`);
        console.log(`  - Character ID: ${character.characterId}`);
        console.log(`  - Is Human NPC: ${character.isHumanNPC}`);
        console.log(`  - Incoming Damage: ${damage}`);
        console.log(`  - Weapon Damage Modifier: ${weaponDmgModifier}`);
        
        // Check if character has helmet
        const helmetSlot = character._loadout && character._loadout[11];
        if (helmetSlot) {
          console.log(`  - Has Helmet: YES (ID: ${helmetSlot.itemDefinitionId}, Durability: ${helmetSlot.currentDurability})`);
        } else {
          console.log(`  - Has Helmet: NO`);
        }
        
        // Call the original function
        const result = server._originalApplyHelmetDamageReduction(character, damage, weaponDmgModifier);
        
        console.log(`  - Reduced Damage: ${result}`);
        
        // Check helmet durability after damage
        if (helmetSlot) {
          console.log(`  - Helmet Durability After: ${helmetSlot.currentDurability}`);
        }
        
        return result;
      };
      
      console.log(`[${this.name}] Wrapped applyHelmetDamageReduction function with debug logging`);
    }
  }

  // Debug method to check armor status
  debugArmorStatus(character) {
    console.log(`[${this.name}] === Armor Status Debug ===`);
    console.log(`Character ID: ${character.characterId}`);
    console.log(`Is Human NPC: ${character.isHumanNPC}`);
    console.log(`Character type: ${character.constructor.name}`);
    
    if (character._loadout) {
      console.log(`Loadout slots:`, Object.keys(character._loadout));
      
      // Check all loadout slots to see what's equipped
      Object.entries(character._loadout).forEach(([slot, item]) => {
        if (item) {
          const itemDef = this.server.getItemDefinition(item.itemDefinitionId);
          console.log(`  Slot ${slot}: ${item.itemDefinitionId} (${itemDef?.NAME || 'Unknown'}) - Durability: ${item.currentDurability}`);
        }
      });
      
      // Check specific armor slots based on your LoadoutSlots
      const armorSlot = 38; // LoadoutSlots.ARMOR
      const helmetSlot = 11; // LoadoutSlots.HEAD
      
      const armor = character._loadout[armorSlot];
      if (armor) {
        console.log(`ARMOR (slot ${armorSlot}):`, {
          itemId: armor.itemDefinitionId,
          durability: armor.currentDurability,
          guid: armor.itemGuid
        });
      } else {
        console.log(`No armor in slot ${armorSlot}`);
      }
      
      const helmet = character._loadout[helmetSlot];
      if (helmet) {
        console.log(`HELMET (slot ${helmetSlot}):`, {
          itemId: helmet.itemDefinitionId,
          durability: helmet.currentDurability,
          guid: helmet.itemGuid
        });
      } else {
        console.log(`No helmet in slot ${helmetSlot}`);
      }
    } else {
      console.log(`No loadout found`);
    }

    if (character._equipmentDurability) {
      console.log(`Equipment durability tracking:`, character._equipmentDurability);
    }
    
    // Test client lookup
    const client = this.server.getClientByCharId(character.characterId);
    console.log(`Client lookup result:`, {
      found: !!client,
      clientType: client?.constructor.name,
      hasCharacter: !!client?.character,
      characterId: client?.character?.characterId
    });
  }

  // Test method to manually damage armor
  testArmorDamage(character, damageAmount = 50) {
    console.log(`[${this.name}] Testing armor damage for character ${character.characterId}`);
    
    const armorSlot = 38; // LoadoutSlots.ARMOR
    const armor = character._loadout && character._loadout[armorSlot];
    
    if (!armor) {
      console.log(`[${this.name}] No armor found in slot ${armorSlot}`);
      return false;
    }
    
    console.log(`[${this.name}] Before damage - Armor durability: ${armor.currentDurability}`);
    
    // Call the server's existing damageItem function
    this.server.damageItem(character, armor, damageAmount);
    
    console.log(`[${this.name}] After damage - Armor durability: ${armor.currentDurability}`);
    
    // Update NPC durability tracking if needed
    if (character.isHumanNPC && character._equipmentDurability) {
      character._equipmentDurability[armor.itemDefinitionId] = armor.currentDurability;
      console.log(`[${this.name}] Updated NPC durability tracking: ${armor.itemDefinitionId} -> ${armor.currentDurability}`);
    }
    
    return true;
  }

  // Check if the armor damage reduction functions are working
  debugDamageReduction(server) {
    console.log(`[${this.name}] Checking damage reduction functions...`);
    
    const hasApplyArmorDamageReduction = typeof server.applyArmorDamageReduction === 'function';
    const hasApplyHelmetDamageReduction = typeof server.applyHelmetDamageReduction === 'function';
    
    console.log(`[${this.name}] Damage reduction methods:`);
    console.log(`  - applyArmorDamageReduction: ${hasApplyArmorDamageReduction}`);
    console.log(`  - applyHelmetDamageReduction: ${hasApplyHelmetDamageReduction}`);
    
    if (hasApplyArmorDamageReduction) {
      console.log(`[${this.name}] applyArmorDamageReduction function found - this should call damageItem`);
    }
    
    if (hasApplyHelmetDamageReduction) {
      console.log(`[${this.name}] applyHelmetDamageReduction function found - this should call damageItem`);
    }
  }

  // Manual test function to simulate what happens during combat
  simulateCombatDamage(attacker, target, weaponDamage = 2500) {
    console.log(`[${this.name}] === SIMULATING COMBAT DAMAGE ===`);
    console.log(`Attacker: ${attacker.characterId}`);
    console.log(`Target: ${target.characterId}`);
    console.log(`Raw weapon damage: ${weaponDamage}`);
    
    // Check if target has armor
    const armorSlot = 38;
    const armor = target._loadout && target._loadout[armorSlot];
    
    if (armor) {
      console.log(`Target has armor: ${armor.itemDefinitionId} (durability: ${armor.currentDurability})`);
      
      // Simulate armor damage reduction
      const reducedDamage = this.server.applyArmorDamageReduction(target, weaponDamage, 4);
      
      console.log(`Damage after armor reduction: ${reducedDamage}`);
      console.log(`Armor durability after hit: ${armor.currentDurability}`);
      
      return {
        originalDamage: weaponDamage,
        reducedDamage: reducedDamage,
        armorDurabilityAfter: armor.currentDurability
      };
    } else {
      console.log(`Target has no armor - full damage applied`);
      return {
        originalDamage: weaponDamage,
        reducedDamage: weaponDamage,
        armorDurabilityAfter: null
      };
    }
  }

  // Ensure NPC has proper durability tracking structure
  ensureDurabilityTracking(npc) {
    if (!npc._equipmentDurability) {
      npc._equipmentDurability = {};
      console.log(`[${this.name}] Added durability tracking to NPC ${npc.characterId}`);
    }
    
    // Sync current loadout durability values to tracking
    if (npc._loadout) {
      Object.values(npc._loadout).forEach(item => {
        if (item && item.itemDefinitionId && typeof item.currentDurability !== 'undefined') {
          npc._equipmentDurability[item.itemDefinitionId] = item.currentDurability;
        }
      });
    }
  }

  patchHitmarkerSystem(server) {
    console.log(`[${this.name}] Patching hitmarker system for accurate armor sounds...`);
    
    // Store the original sendHitmarker function
    const originalSendHitmarker = server.sendHitmarker.bind(server);
    
    // Override the server's sendHitmarker function
    server.sendHitmarker = function(client, hitLocation, hasHelmet, hasArmor, hasHelmetBefore, hasArmorBefore) {
      
      // Check if this hitmarker is for a human NPC by looking at recent damage events
      // We'll store hit location context in a temporary variable
      const hitLower = hitLocation ? hitLocation.toLowerCase() : '';
      
      // Determine if this hit location should actually show armor/helmet protection
      const shouldShowArmorProtection = hitLower && (
        hitLower === 'spineupper' ||
        hitLower === 'spinelower' ||
        hitLower === 'spinemiddle'
      );
      
      const shouldShowHelmetProtection = hitLower && (
        hitLower === 'head' || 
        hitLower === 'glasses' ||
        hitLower === 'neck'
      );
      
      // For non-armor/helmet hit locations, force armor/helmet states to false
      const correctedHasHelmet = shouldShowHelmetProtection ? hasHelmet : false;
      const correctedHasArmor = shouldShowArmorProtection ? hasArmor : false;
      const correctedHasHelmetBefore = shouldShowHelmetProtection ? hasHelmetBefore : false;
      const correctedHasArmorBefore = shouldShowArmorProtection ? hasArmorBefore : false;
      
      // Log the correction for debugging
      if (!shouldShowArmorProtection && hasArmor) {
        console.log(`[${server.destroMOD?.name || 'destroMOD'}] [HITMARKER_FIX] Suppressed armor sound for ${hitLocation} hit`);
      }
      if (!shouldShowHelmetProtection && hasHelmet) {
        console.log(`[${server.destroMOD?.name || 'destroMOD'}] [HITMARKER_FIX] Suppressed helmet sound for ${hitLocation} hit`);
      }
      
      // Call the original function with corrected parameters
      return originalSendHitmarker(
        client, 
        hitLocation, 
        correctedHasHelmet, 
        correctedHasArmor, 
        correctedHasHelmetBefore, 
        correctedHasArmorBefore
      );
    };
    
    console.log(`[${this.name}] Hitmarker system patched - armor sounds will only play for spine hits`);
  }
}



module.exports = ArmorDamageSystem;