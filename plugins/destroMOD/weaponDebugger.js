// weaponDebugger.js - Weapon System Debug Logger
// Place this file in the same folder as plugin.js and humanAI.js
"use strict";

class WeaponDebugger {
  constructor(plugin) {
    this.plugin = plugin;
    this.name = "WeaponDebugger";
    this.isPatched = false;
  }

  init(server) {
    console.log(`[${this.name}] Initializing weapon packet debugger...`);
    
    if (this.isPatched) {
      console.log(`[${this.name}] Already patched - skipping`);
      return;
    }
    
    this.patchWeaponPacketHandler(server);
    this.patchWeaponFire(server);
    this.patchRegisterHit(server);
    
    this.isPatched = true;
    console.log(`[${this.name}] Weapon debugging active - shoot your AK-47 at an NPC to see projectile data`);
  }

  patchWeaponPacketHandler(server) {
    // Check if function exists first
    if (!server.handleWeaponPacket || typeof server.handleWeaponPacket !== 'function') {
      console.log(`[${this.name}] handleWeaponPacket not found - will retry later`);
      // Retry after server is fully initialized
      setTimeout(() => {
        this.patchWeaponPacketHandler(server);
      }, 5000);
      return;
    }
    
    // Store original function
    const originalHandleWeaponPacket = server.handleWeaponPacket.bind(server);
    
    // Override with debug logging
    server.handleWeaponPacket = function(server, client, packet) {
      
      // Log all weapon packets
      console.log(`[WEAPON_DEBUG] ==========================================`);
      console.log(`[WEAPON_DEBUG] Player: ${client.character?.name || 'Unknown'}`);
      console.log(`[WEAPON_DEBUG] Packet: ${packet.packetName}`);
      console.log(`[WEAPON_DEBUG] Game Time: ${packet.gameTime}`);
      
      // Special logging for specific packets
      if (packet.packetName === "Weapon.Fire") {
        console.log(`[WEAPON_DEBUG] *** FIRE PACKET ***`);
        console.log(`[WEAPON_DEBUG] Fire data:`, JSON.stringify(packet.packet, null, 2));
      }
      
      if (packet.packetName === "Weapon.ProjectileHitReport") {
        console.log(`[WEAPON_DEBUG] *** HIT REPORT PACKET ***`);
        console.log(`[WEAPON_DEBUG] Hit report:`, JSON.stringify(packet.packet, null, 2));
      }
      
      if (packet.packetName === "Weapon.WeaponFireHint") {
        console.log(`[WEAPON_DEBUG] *** FIRE HINT PACKET ***`);
        console.log(`[WEAPON_DEBUG] Fire hint:`, JSON.stringify(packet.packet, null, 2));
      }
      
      if (packet.packetName === "Weapon.ProjectileSpawnNpc") {
        console.log(`[WEAPON_DEBUG] *** PROJECTILE SPAWN PACKET ***`);
        console.log(`[WEAPON_DEBUG] Projectile spawn:`, JSON.stringify(packet.packet, null, 2));
      }
      
      console.log(`[WEAPON_DEBUG] ==========================================`);
      
      // Call original function
      return originalHandleWeaponPacket(server, client, packet);
    };
    
    console.log(`[${this.name}] Patched handleWeaponPacket for debugging`);
  }

  patchWeaponFire(server) {
    // Check if function exists first
    if (!server.handleWeaponFire || typeof server.handleWeaponFire !== 'function') {
      console.log(`[${this.name}] handleWeaponFire not found - will retry later`);
      setTimeout(() => {
        this.patchWeaponFire(server);
      }, 5000);
      return;
    }
    
    // Store original function
    const originalHandleWeaponFire = server.handleWeaponFire.bind(server);
    
    // Override with debug logging
    server.handleWeaponFire = function(client, weaponItem, packet) {
      console.log(`[WEAPON_DEBUG] *** HANDLE_WEAPON_FIRE START ***`);
      console.log(`[WEAPON_DEBUG] Player: ${client.character?.name}`);
      console.log(`[WEAPON_DEBUG] Weapon: ${weaponItem.itemDefinitionId} (${weaponItem.itemGuid})`);
      console.log(`[WEAPON_DEBUG] Ammo count: ${weaponItem.weapon?.ammoCount}`);
      
      // Call original function
      const result = originalHandleWeaponFire(client, weaponItem, packet);
      
      // Log fireHints after creation
      const projectileCount = packet.packet.sessionProjectileCount;
      const fireHint = client.fireHints[projectileCount];
      
      if (fireHint) {
        console.log(`[WEAPON_DEBUG] *** CREATED FIRE HINT ***`);
        console.log(`[WEAPON_DEBUG] FireHint ID: ${fireHint.id}`);
        console.log(`[WEAPON_DEBUG] ProjectileUniqueId: ${fireHint.projectileUniqueId}`);
        console.log(`[WEAPON_DEBUG] Position:`, fireHint.position);
        console.log(`[WEAPON_DEBUG] Rotation: ${fireHint.rotation}`);
        console.log(`[WEAPON_DEBUG] TimeStamp: ${fireHint.timeStamp}`);
        console.log(`[WEAPON_DEBUG] WeaponItem ID: ${fireHint.weaponItem.itemDefinitionId}`);
        console.log(`[WEAPON_DEBUG] Complete FireHint:`, JSON.stringify(fireHint, null, 2));
      } else {
        console.log(`[WEAPON_DEBUG] *** NO FIRE HINT CREATED ***`);
      }
      
      console.log(`[WEAPON_DEBUG] *** HANDLE_WEAPON_FIRE END ***`);
      return result;
    };
    
    console.log(`[${this.name}] Patched handleWeaponFire for debugging`);
  }

  patchRegisterHit(server) {
    // Check if function exists first
    if (!server.registerHit || typeof server.registerHit !== 'function') {
      console.log(`[${this.name}] registerHit not found - will retry later`);
      setTimeout(() => {
        this.patchRegisterHit(server);
      }, 5000);
      return;
    }
    
    // Store original function
    const originalRegisterHit = server.registerHit.bind(server);
    
    // Override with debug logging
    server.registerHit = function(client, packet, gameTime) {
      console.log(`[WEAPON_DEBUG] *** REGISTER_HIT START ***`);
      console.log(`[WEAPON_DEBUG] Player: ${client.character?.name}`);
      console.log(`[WEAPON_DEBUG] Game Time: ${gameTime}`);
      console.log(`[WEAPON_DEBUG] Hit Report:`, JSON.stringify(packet.hitReport, null, 2));
      
      // Find the fireHint
      const fireHint = client.fireHints[packet.hitReport.sessionProjectileCount];
      if (fireHint) {
        console.log(`[WEAPON_DEBUG] *** FOUND MATCHING FIRE HINT ***`);
        console.log(`[WEAPON_DEBUG] FireHint:`, JSON.stringify(fireHint, null, 2));
      } else {
        console.log(`[WEAPON_DEBUG] *** NO MATCHING FIRE HINT FOUND ***`);
        console.log(`[WEAPON_DEBUG] Available fireHints:`, Object.keys(client.fireHints));
      }
      
      // Get target entity
      const entity = server.getEntity(packet.hitReport.characterId);
      if (entity) {
        console.log(`[WEAPON_DEBUG] Target: ${entity.characterId} (${entity.constructor.name})`);
        console.log(`[WEAPON_DEBUG] Target isHumanNPC: ${entity.isHumanNPC}`);
        console.log(`[WEAPON_DEBUG] Target position:`, entity.state.position);
      }
      
      // Call original function
      const result = originalRegisterHit(client, packet, gameTime);
      
      console.log(`[WEAPON_DEBUG] *** REGISTER_HIT END ***`);
      return result;
    };
    
    console.log(`[${this.name}] Patched registerHit for debugging`);
  }
}

module.exports = WeaponDebugger;