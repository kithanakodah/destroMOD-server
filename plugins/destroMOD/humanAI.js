// ========================================
// Human NPC AI - Enhanced with Proper Head Tracking and Distance Management
// File: E:\...\destroMOD-server\plugins\destroMOD\humanAI.js
// ========================================

"use strict";

const path = require('path');
const serverModulePath = path.join(process.cwd(), 'node_modules/h1z1-server');
const { getDistance, getCurrentServerTimeWrapper, randomIntFromInterval } = require(path.join(serverModulePath, 'out/utils/utils'));
const { Npc } = require(path.join(serverModulePath, 'out/servers/ZoneServer2016/entities/npc'));
const { ProjectileEntity } = require(path.join(serverModulePath, 'out/servers/ZoneServer2016/entities/projectileentity'));
const { Items } = require(path.join(serverModulePath, 'out/servers/ZoneServer2016/models/enums'));

class HumanAI {
    constructor(plugin) {
        this.plugin = plugin;
    }

    startup(server) {
        console.log(`[${this.plugin.name}] Starting Human AI initialization...`);
        const aiManager = server.aiManager;
        if (!aiManager) return console.error(`[${this.plugin.name}] FATAL: Could not find AIManager.`);

        // Create a separate set for human NPCs
        aiManager.humanNpcEntities = new Set();
        
        // Store original addEntity method
        const originalAddEntity = aiManager.addEntity.bind(aiManager);
        aiManager.addEntity = (entity) => {
            if (entity instanceof Npc) {
                // Check if this is a human NPC (you can identify by model ID or a custom flag)
                if (entity.isHumanNPC) {
                    aiManager.humanNpcEntities.add(entity);
                    // Set human-specific properties
                    entity.personalShootRadius = this.plugin.SHOOT_RADIUS_MIN + Math.random() * (this.plugin.SHOOT_RADIUS_MAX - this.plugin.SHOOT_RADIUS_MIN);
                    entity.personalAggroRadius = this.plugin.AGGRO_RADIUS_MIN + Math.random() * (this.plugin.AGGRO_RADIUS_MAX - this.plugin.AGGRO_RADIUS_MIN);
                    entity.personalMoveSpeed = this.plugin.MOVE_SPEED_MIN + Math.random() * (this.plugin.MOVE_SPEED_MAX - this.plugin.MOVE_SPEED_MIN);
                    // Don't randomly assign weapon - use the one set by the spawn function
                    if (!entity.weapon) {
                        entity.weapon = this.assignRandomWeapon();
                    }
                    console.log(`[${this.plugin.name}] Human NPC ${entity.characterId} added with weapon ${Items[entity.weapon] || entity.weapon}`);
                } else {
                    // Regular NPC (zombie), add to normal set
                    aiManager.npcEntities.add(entity);
                    entity.personalAttackRadius = this.plugin.ATTACK_RADIUS_MIN + Math.random() * (this.plugin.ATTACK_RADIUS_MAX - this.plugin.ATTACK_RADIUS_MIN);
                    entity.personalAggroRadius = this.plugin.AGGRO_RADIUS_MIN + Math.random() * (this.plugin.AGGRO_RADIUS_MAX - this.plugin.AGGRO_RADIUS_MIN);
                    entity.personalMoveSpeed = this.plugin.MOVE_SPEED_MIN + Math.random() * (this.plugin.MOVE_SPEED_MAX - this.plugin.MOVE_SPEED_MIN);
                }
            }
            originalAddEntity(entity);
        };
        console.log(`[${this.plugin.name}] Patched AIManager to handle Human NPC entities.`);

        this.patchHumanNpcDamage(server);

        // Patch the AI run method to include human NPCs
        const originalRun = aiManager.run.bind(aiManager);
        aiManager.run = () => {
            originalRun(); // Run original AI for zombies
            this.runHumanAiTick(aiManager); // Run our human AI
        };
        console.log(`[${this.plugin.name}] Human AI is now fully active.`);
    }

    assignRandomWeapon() {
        const weapons = [
            Items.WEAPON_AR15,      // 10
            Items.WEAPON_AK47       // 2229
        ];
        return weapons[Math.floor(Math.random() * weapons.length)];
    }

    patchHumanNpcDamage(server) {
        const plugin = this.plugin;
        const humanAI = this;
        const originalDamage = Npc.prototype.damage;

        Npc.prototype.damage = async function(server, damageInfo) {
            let wasJustEnraged = false;
            let client = server.getClientByCharId(damageInfo.entity);
            if (!client) {
                const sourceEntity = server.getEntity(damageInfo.entity);
                if (sourceEntity instanceof ProjectileEntity) {
                    client = server.getClientByCharId(sourceEntity.managerCharacterId);
                }
            }

            if (client && this.isHumanNPC) {
                if (this.personalAggroRadius < plugin.ENRAGED_AGGRO_RADIUS) {
                    console.log(`[${plugin.name}] Human NPC ${this.characterId} enraged by player! New aggro radius: ${plugin.ENRAGED_AGGRO_RADIUS}`);
                    this.personalAggroRadius = plugin.ENRAGED_AGGRO_RADIUS;
                    this.personalShootRadius = plugin.ENRAGED_SHOOT_RADIUS;
                    wasJustEnraged = true;
                }
            }
            
            // Call the original damage function first
            const result = await originalDamage.apply(this, arguments);

            // If the human NPC was just enraged, alert nearby humans
            if (wasJustEnraged && this.isHumanNPC) {
                humanAI.alertNearbyHumans(this, server);
            }

            return result;
        };

        console.log(`[${plugin.name}] Patched Npc.damage to handle human aggro and alerts.`);
    }

    alertNearbyHumans(enragedHuman, server) {
        const aiManager = server.aiManager;
        const plugin = this.plugin;

        console.log(`[${plugin.name}] Enraged human ${enragedHuman.characterId} is alerting others within ${plugin.ALERT_RADIUS} units.`);

        if (aiManager.humanNpcEntities) {
            aiManager.humanNpcEntities.forEach((otherNpc) => {
                if (otherNpc.characterId === enragedHuman.characterId || !otherNpc.isAlive) {
                    return;
                }

                const distance = getDistance(enragedHuman.state.position, otherNpc.state.position);

                if (distance <= plugin.ALERT_RADIUS) {
                    const newAggroRadius = plugin.ALERTED_AGGRO_RADIUS_MIN + Math.random() * (plugin.ALERTED_AGGRO_RADIUS_MAX - plugin.ALERTED_AGGRO_RADIUS_MIN);
                    const newShootRadius = plugin.ALERTED_SHOOT_RADIUS_MIN + Math.random() * (plugin.ALERTED_SHOOT_RADIUS_MAX - plugin.ALERTED_SHOOT_RADIUS_MIN);
                    
                    if (otherNpc.personalAggroRadius < newAggroRadius) {
                        console.log(`[${plugin.name}] Human NPC ${enragedHuman.characterId} alerted nearby human ${otherNpc.characterId}! New aggro: ${newAggroRadius.toFixed(2)}`);
                        otherNpc.personalAggroRadius = newAggroRadius;
                        otherNpc.personalShootRadius = newShootRadius;
                    }
                }
            });
        }
    }

    runHumanAiTick(aiManager) {
        if (!aiManager.humanNpcEntities) return;
        
        aiManager.humanNpcEntities.forEach((npc) => {
            try {
                if (!npc || !npc.state) { return; }
                if (npc.aiState === undefined) npc.aiState = 'IDLE';
                if (!npc.isAlive) {
                    if (npc.aiState !== 'IDLE') this.changeHumanState(npc, 'IDLE');
                    return;
                }
                const closestPlayer = this.findClosestPlayer(npc, aiManager);
                const newState = this.determineHumanState(npc, closestPlayer);
                if (npc.aiState !== newState) { this.changeHumanState(npc, newState); }
                this.executeHumanContinuousAction(npc, closestPlayer);
            } catch (e) {
                console.error(`[${this.plugin.name}] Human AI tick failed for NPC ${npc.characterId || 'UNKNOWN'}:`, e);
            }
        });
    }

    changeHumanState(npc, newState) {
        const oldState = npc.aiState || 'IDLE';
        if (oldState === newState) return;
        npc.aiState = newState;
        switch (newState) {
            case 'IDLE': 
                this.executeStop(npc); 
                npc.playAnimation("Idle"); 
                break;
            case 'SHOOTING': 
                this.executeStop(npc); 
                npc.playAnimation("Combat_Rifle_Aim");
                break;
            case 'CHASING': 
                npc.playAnimation("walk"); 
                break;
        }
    }

    executeHumanContinuousAction(npc, target) {
        if (npc.aiState === 'CHASING' && target) { this.executeMovement(npc, target); }
        if (npc.aiState === 'SHOOTING' && target) { this.tryShoot(npc, target); }
    }

    executeMovement(npc, target) {
        const moveSpeed = npc.personalMoveSpeed || this.plugin.MOVE_SPEED_MIN;
        const moveDistance = moveSpeed * 0.05;
        const dirX = target.state.position[0] - npc.state.position[0];
        const dirZ = target.state.position[2] - npc.state.position[2];
        const length = Math.sqrt(dirX * dirX + dirZ * dirZ);
        if (length < 0.1) return;
        const normX = dirX / length;
        const normZ = dirZ / length;
        npc.state.position[0] += normX * moveDistance;
        npc.state.position[2] += normZ * moveDistance;
        const orientation = Math.atan2(normX, normZ);
        this.sendMovementPacket(npc, orientation, moveSpeed);
    }

    // ENHANCED: Realistic Head Tracking with Forward Focus
    faceTarget(npc, target) {
        const now = Date.now();
        
        // Initialize tracking state if needed
        if (!npc.lastFaceUpdate) {
            npc.lastFaceUpdate = 0;
            npc.currentFacing = npc.state.orientation || 0;
            npc.comfortZone = 0.25; // ~14 degrees comfort zone
        }
        
        // Don't update face direction too frequently (realistic)
        if (now - npc.lastFaceUpdate < 600) { 
            return; // Keep current facing
        }
        
        const dirX = target.state.position[0] - npc.state.position[0];
        const dirZ = target.state.position[2] - npc.state.position[2];
        const distance = Math.sqrt(dirX * dirX + dirZ * dirZ);
        
        // Don't track if too close (prevents spinning)
        if (distance < 2.5) {
            return;
        }
        
        const targetOrientation = Math.atan2(dirX, dirZ);
        const currentOrientation = npc.currentFacing;
        
        // Calculate angle difference
        let angleDiff = targetOrientation - currentOrientation;
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        
        // Only update if outside comfort zone
        if (Math.abs(angleDiff) < npc.comfortZone) {
            return; // Stay looking current direction - FORWARD FOCUS!
        }
        
        npc.lastFaceUpdate = now;
        
        // Smooth rotation toward target
        const rotationSpeed = 0.08; // Slow, realistic
        let newOrientation;
        
        if (Math.abs(angleDiff) <= rotationSpeed) {
            newOrientation = targetOrientation; // Close enough, snap
        } else {
            newOrientation = currentOrientation + (angleDiff > 0 ? rotationSpeed : -rotationSpeed);
        }
        
        // Normalize angle
        while (newOrientation > Math.PI) newOrientation -= 2 * Math.PI;
        while (newOrientation < -Math.PI) newOrientation += 2 * Math.PI;
        
        npc.currentFacing = newOrientation;
        
        // Send the movement packet
        this.sendMovementPacket(npc, newOrientation, 0);
    }

    // ENHANCED: Better Shooting with Proper Distance Management
    tryShoot(npc, target) {
        const now = Date.now();
        const canShootAt = this.plugin.shootCooldowns.get(npc.characterId) || 0;
        if (now >= canShootAt) {
            const randomCooldown = randomIntFromInterval(this.plugin.SHOOT_COOLDOWN_MIN_MS, this.plugin.SHOOT_COOLDOWN_MAX_MS);
            this.plugin.shootCooldowns.set(npc.characterId, now + randomCooldown);
            
            // Face target BEFORE shooting (with proper distance check)
            this.faceTarget(npc, target);
            
            npc.playAnimation("Combat_Rifle_Fire");
            
            // Calculate weapon damage
            const weaponDamage = this.getWeaponDamage(npc.weapon);
            
            // Create damage info similar to your zombie system
            const client = npc.server.getClientByCharId(target.characterId);
            if (client) {
                client.character.damage(npc.server, {
                    entity: npc.characterId,
                    weapon: npc.weapon,
                    damage: weaponDamage,
                    causeBleed: true,
                    hitReport: {
                        sessionProjectileCount: 1,
                        characterId: target.characterId,
                        position: target.state.position,
                        unknownFlag1: 0,
                        unknownByte2: 0,
                        totalShotCount: 1
                    }
                });
                
                console.log(`[${this.plugin.name}] Human NPC ${npc.characterId} shot ${target.characterId} with ${Items[npc.weapon] || npc.weapon} for ${weaponDamage} damage`);
            }

            // Enhanced weapon fire effect to all clients
            try {
                npc.server.sendDataToAllWithSpawnedEntity(
                    npc.server._npcs,
                    npc.characterId,
                    "Weapon.FireStateUpdate",
                    {
                        characterId: npc.characterId,
                        weaponItem: npc.weapon,
                        unknownDword1: 0,
                        firePosition: npc.state.position,
                        fireDirection: this.getDirectionTo(npc, target),
                        unknownDword2: 0,
                        unknownDword3: 0,
                        unknownDword4: 0,
                        travelDistanceMax: 100,
                        unknownDword5: 0,
                        unknownByte1: 0,
                        unknownDword6: 0
                    }
                );

                // Add muzzle flash effect
                npc.server.sendDataToAllWithSpawnedEntity(
                    npc.server._npcs,
                    npc.characterId,
                    "Character.PlayWorldCompositeEffect",
                    {
                        characterId: npc.characterId,
                        effectId: 5151, // Muzzle flash effect ID
                        position: npc.state.position,
                        effectTime: 1000
                    }
                );
            } catch (error) {
                console.log(`[${this.plugin.name}] Error sending weapon effects:`, error);
            }
        }
    }

    getWeaponDamage(weapon) {
        switch (weapon) {
            case Items.WEAPON_AR15: return randomIntFromInterval(180, 220);
            case Items.WEAPON_AK47: return randomIntFromInterval(200, 240);
            case Items.WEAPON_1911: return randomIntFromInterval(120, 160);
            default: return randomIntFromInterval(150, 200);
        }
    }

    getDirectionTo(npc, target) {
        const dx = target.state.position[0] - npc.state.position[0];
        const dz = target.state.position[2] - npc.state.position[2];
        const distance = Math.sqrt(dx * dx + dz * dz);
        return distance > 0 ? [dx / distance, 0, dz / distance] : [0, 0, 1];
    }

    executeStop(npc) {
        if (npc.lastSentSpeed !== 0) { this.sendMovementPacket(npc, npc.state.orientation, 0); }
    }

    sendMovementPacket(npc, orientation, speed) {
        npc.lastSentSpeed = speed;
        npc.state.orientation = orientation;
        npc.server.sendDataToAllWithSpawnedEntity(npc.server._npcs, npc.characterId, "PlayerUpdatePosition", {
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
                horizontalSpeed: speed
            }
        });
    }

    findClosestPlayer(npc, aiManager) {
        const aggroRadius = npc.personalAggroRadius || this.plugin.AGGRO_RADIUS_MAX;
        let closestPlayer = null;
        let minDistance = aggroRadius;
        aiManager.playerEntities.forEach((player) => {
            if (!player.isAlive) return;
            const distance = getDistance(npc.state.position, player.state.position);
            if (distance <= minDistance) {
                minDistance = distance;
                closestPlayer = player;
            }
        });
        return closestPlayer;
    }

    // ENHANCED: Better State Determination with Proper Distance Management
    determineHumanState(npc, player) {
        if (!player) return 'IDLE';
        const distance = getDistance(npc.state.position, player.state.position);
        const verticalDistance = Math.abs(npc.state.position[1] - player.state.position[1]);
        const shootRadius = npc.personalShootRadius || this.plugin.SHOOT_RADIUS_MAX;
        const aggroRadius = npc.personalAggroRadius || this.plugin.AGGRO_RADIUS_MAX;
        
        if (verticalDistance > this.plugin.MAX_VERTICAL_AGGRO_DISTANCE) { return 'IDLE'; }
        
        // ENHANCED: Better distance management
        // If too close, stop moving and just shoot
        if (distance <= Math.min(shootRadius * 0.6, 8.0)) { // Stop at 60% of shoot radius or 8 meters
            return 'SHOOTING';
        }
        // If in shooting range but not too close, shoot
        if (distance <= shootRadius) {
            return 'SHOOTING';
        }
        // If in aggro range but outside shooting range, chase
        if (distance <= aggroRadius) {
            return 'CHASING';
        }
        
        return 'IDLE';
    }
}

module.exports = HumanAI;