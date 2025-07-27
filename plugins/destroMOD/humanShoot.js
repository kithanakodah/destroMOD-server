// humanShoot.js - NPC Weapon System using Server's Real Weapon Functions
"use strict";

const path = require('path');
const serverModulePath = path.join(process.cwd(), 'node_modules/h1z1-server');
const { getDistance, randomIntFromInterval } = require(path.join(serverModulePath, 'out/utils/utils'));

class HumanShoot {
  constructor(plugin) {
    this.plugin = plugin;
    this.name = "HumanShoot";
  }

  // Main shooting method called from humanAI
  tryShoot(npc, target) {
    const now = Date.now();
    const canShootAt = this.plugin.shootCooldowns.get(npc.characterId) || 0;
    if (now >= canShootAt) {
      const randomCooldown = randomIntFromInterval(this.plugin.SHOOT_COOLDOWN_MIN_MS, this.plugin.SHOOT_COOLDOWN_MAX_MS);
      this.plugin.shootCooldowns.set(npc.characterId, now + randomCooldown);
      
      // Face target and play animation (keep this in humanAI for now)
      // this.faceTarget(npc, target);
      npc.playAnimation("Combat_Rifle_Fire");
      
      // Use the server's weapon system properly
      this.fireWeaponLikePlayer(npc, target);
    }
  }

  // Fire weapon exactly like players do using server's weapon system
  fireWeaponLikePlayer(npc, target) {
    const server = npc.server;
    
    // Initialize NPC as pseudo-client with proper validation
    if (!npc.fireHints) npc.fireHints = {};
    if (!npc.sessionProjectileCount) npc.sessionProjectileCount = 0;
    
    npc.sessionProjectileCount++;
    
    // Create weapon item exactly like players have
    const weaponItem = {
      itemDefinitionId: npc.weapon || 2229,
      itemGuid: npc.characterId + "_weapon",
      currentDurability: 1000, // Fixed: weapon needs durability
      weapon: {
        ammoCount: 30,
        itemDefinitionId: npc.weapon || 2229
      }
    };
    
    // Create weapon fire packet exactly like client sends
    const weaponFirePacket = {
      packet: {
        guid: weaponItem.itemGuid,
        position: npc.state.position,
        weaponProjectileCount: 1,
        sessionProjectileCount: npc.sessionProjectileCount,
        projectileUniqueId: 0 // Server calculates this
      },
      gameTime: Date.now()
    };
    
    // Create fake client for NPC with all required properties
    const fakeClient = {
      character: npc,
      fireHints: npc.fireHints,
      vehicle: { mountedVehicle: null },
      spawnedEntities: new Set([target]),
      flaggedShots: 0,
      isFairPlayFlagged: false,
      characterId: npc.characterId,
      loginSessionId: `npc_${npc.characterId}`,
      gameTime: Date.now(),
      isAdmin: false,
      banType: null,
      isLoading: false
    };

    // Add missing methods to fake client's character
    fakeClient.character.addCombatlogEntry = function() {
      // Do nothing - NPCs don't need combat log entries
    };

    // Ensure character has required properties
    if (!fakeClient.character._loadout) {
      fakeClient.character._loadout = {};
    }
    if (!fakeClient.character._containers) {
      fakeClient.character._containers = {};
    }
    
    try {
      // Use server's handleWeaponFire exactly like players
      server.handleWeaponFire(fakeClient, weaponItem, weaponFirePacket);
      
      // Send visual effects (muzzle flash, etc.)
      server.sendRemoteWeaponUpdateDataToAllOthers(
        fakeClient,
        npc.transientId,
        weaponItem.itemGuid,
        "Update.ProjectileLaunch",
        {}
      );
      
      // Send weapon fire effects
      server.sendDataToAllWithSpawnedEntity(
        server._npcs,
        npc.characterId,
        "Character.PlayWorldCompositeEffect",
        {
          characterId: npc.characterId,
          effectId: 5151,
          position: npc.state.position,
          effectTime: 1000
        }
      );
      
      // Calculate bullet travel time (basic physics)
      const distance = getDistance(npc.state.position, target.state.position);
      const bulletSpeed = 600; // m/s from projectile definition
      const travelTimeMs = (distance / bulletSpeed) * 1000;
      
      // Simulate client sending hit report after travel time
      setTimeout(() => {
        this.sendHitReportLikeClient(npc, target, fakeClient, npc.sessionProjectileCount);
      }, Math.max(30, travelTimeMs));
      
      console.log(`[${this.plugin.name}] NPC fired using server weapon system, travel time: ${travelTimeMs.toFixed(1)}ms`);
      
    } catch (error) {
      console.error(`[${this.plugin.name}] Error using server weapon system:`, error);
    }
  }

  // Send hit report exactly like client does
  sendHitReportLikeClient(npc, target, fakeClient, sessionProjectileCount) {
    const server = npc.server;
    
    try {
      console.log(`[${this.plugin.name}] Sending hit report for session ${sessionProjectileCount}`);
      
      // Random hit locations for more realistic combat
      const hitLocations = [
        "HEAD",        // Headshots (high damage)
        "spineUpper",  // Upper torso (armor protection) 
        "spineLower",  // Lower torso (armor protection)
        "spineMiddle", // Middle torso (armor protection)
        "l_shoulder",  // Left shoulder
        "r_shoulder",  // Right shoulder
        "l_elbow",     // Left arm
        "r_elbow",     // Right arm
        "l_knee",      // Left leg
        "r_knee"       // Right leg
      ];
      
      const randomHitLocation = hitLocations[Math.floor(Math.random() * hitLocations.length)];
      
      // TEMPORARILY register fake client just for the hit processing
      const originalClient = server._clients[npc.characterId];
      server._clients[npc.characterId] = fakeClient;
      
      const hitReportPacket = {
        hitReport: {
          sessionProjectileCount: sessionProjectileCount,
          characterId: target.characterId,
          position: target.state.position,
          hitLocationLen: 4,
          unknownFlag1: 32,
          hitLocation: randomHitLocation,
          unknownBytes: {
            unknownBytes: Buffer.from([131, 6, sessionProjectileCount, 0, 0, 0, 206, 95, 35])
          },
          totalShotCount: sessionProjectileCount,
          unknownByte2: 128
        }
      };
      
      // Add debug before hit processing
      console.log(`[HumanShoot] About to register hit:`);
      console.log(`  - NPC: ${npc.characterId}`);
      console.log(`  - Target: ${target.characterId}`);
      console.log(`  - Target is alive: ${target.isAlive}`);
      console.log(`  - Hit location: ${hitReportPacket.hitReport.hitLocation}`);
      console.log(`  - Session count: ${hitReportPacket.hitReport.sessionProjectileCount}`);
      console.log(`  - Target position:`, target.state.position);
      console.log(`  - Hit report position:`, hitReportPacket.hitReport.position);
      
      // Store original getProjectileDamage function
      const originalGetProjectileDamage = server.getProjectileDamage;

      // Debug the function override
      console.log(`[HumanShoot] About to call registerHit`);
      console.log(`[HumanShoot] server.getProjectileDamage function:`, typeof server.getProjectileDamage);
      console.log(`[HumanShoot] Original function stored:`, typeof originalGetProjectileDamage);

      // Temporarily override getProjectileDamage to reduce NPC damage by 90%
      server.getProjectileDamage = function(itemDefinitionId, sourcePos, targetPos) {
        const originalDamage = originalGetProjectileDamage.call(this, itemDefinitionId, sourcePos, targetPos);
        const reducedDamage = Math.round(originalDamage * 0.1); // 90% reduction
        console.log(`[HumanShoot] Reduced NPC damage: ${originalDamage} -> ${reducedDamage}`);
        return reducedDamage;
      };

      // Test if our override is actually in place
      const testDamage = server.getProjectileDamage(2229, [0,0,0], [1,1,1]);
      console.log(`[HumanShoot] Test damage call result: ${testDamage}`);

      // Process hit with reduced damage
      const hitResult = server.registerHit(fakeClient, hitReportPacket, Date.now());
      console.log(`[HumanShoot] registerHit result:`, hitResult);
      console.log(`[HumanShoot] registerHit completed - checking if damage was applied`);

      // Restore original function immediately
      server.getProjectileDamage = originalGetProjectileDamage;
      
      // IMMEDIATELY clean up fake client
      if (originalClient) {
        server._clients[npc.characterId] = originalClient;
      } else {
        delete server._clients[npc.characterId];
      }
      
      console.log(`[${this.plugin.name}] NPC hit report processed and cleaned up`);
      
    } catch (error) {
      console.error(`[${this.plugin.name}] Error sending hit report:`, error);
      // Ensure cleanup on error
      delete server._clients[npc.characterId];
    }
  }
}

module.exports = HumanShoot;