// ========================================
// Human NPC AI - FIXED: Single Loot Bag Only
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
        this.debugMode = false; // Reduced debug output for cleaner console
        this.lastDebugTime = 0;
        this.hasHookedDamage = false; // Track if we've hooked damage system
    }

    startup(server) {
        console.log(`[${this.plugin.name}] Starting Human AI initialization...`);
        const aiManager = server.aiManager;
        if (!aiManager) return console.error(`[${this.plugin.name}] FATAL: Could not find AIManager.`);

        // Create a separate set for human NPCs
        aiManager.humanNpcEntities = new Set();
        
        // Store original methods BEFORE zombieAI overwrites them
        if (!aiManager.originalAddEntity) {
            aiManager.originalAddEntity = aiManager.addEntity.bind(aiManager);
        }
        if (!aiManager.originalRun) {
            aiManager.originalRun = aiManager.run.bind(aiManager);
        }
        
        // Enhanced addEntity that properly handles both zombies and humans
        aiManager.addEntity = (entity) => {
            if (entity instanceof Npc) {
                // Only log human NPCs to reduce spam
                if (entity.isHumanNPC === true || entity.actorModelId === 9469) {
                    console.log(`[${this.plugin.name}] [DEBUG] Adding HUMAN entity ${entity.characterId}: isHumanNPC=${entity.isHumanNPC}, modelId=${entity.actorModelId}`);
                }
                
                if (entity.isHumanNPC === true) {
                    // This is a HUMAN NPC
                    aiManager.humanNpcEntities.add(entity);
                    
                    // Set HUMAN-specific properties (different from zombies)
                    entity.personalShootRadius = this.plugin.SHOOT_RADIUS_MIN + Math.random() * (this.plugin.SHOOT_RADIUS_MAX - this.plugin.SHOOT_RADIUS_MIN);
                    entity.personalAggroRadius = this.plugin.AGGRO_RADIUS_MIN + Math.random() * (this.plugin.AGGRO_RADIUS_MAX - this.plugin.AGGRO_RADIUS_MIN);
                    entity.personalMoveSpeed = this.plugin.MOVE_SPEED_MIN + Math.random() * (this.plugin.MOVE_SPEED_MAX - this.plugin.MOVE_SPEED_MIN);
                    
                    // HUMAN-specific AI state
                    entity.aiType = 'HUMAN';
                    entity.trackingRange = entity.personalAggroRadius;
                    
                    // Don't randomly assign weapon - use the one set by spawn function
                    if (!entity.weapon) {
                        entity.weapon = this.assignRandomWeapon();
                    }
                    
                    console.log(`[${this.plugin.name}] Human NPC ${entity.characterId} configured: weapon=${Items[entity.weapon] || entity.weapon}, shootRadius=${entity.personalShootRadius.toFixed(1)}, aggroRadius=${entity.personalAggroRadius.toFixed(1)}`);
                    
                } else {
                    // This is a ZOMBIE NPC
                    if (!aiManager.npcEntities) {
                        aiManager.npcEntities = new Set();
                    }
                    aiManager.npcEntities.add(entity);
                    
                    // Set ZOMBIE-specific properties
                    entity.personalAttackRadius = this.plugin.ATTACK_RADIUS_MIN + Math.random() * (this.plugin.ATTACK_RADIUS_MAX - this.plugin.ATTACK_RADIUS_MIN);
                    entity.personalAggroRadius = this.plugin.AGGRO_RADIUS_MIN + Math.random() * (this.plugin.AGGRO_RADIUS_MAX - this.plugin.AGGRO_RADIUS_MIN);
                    entity.personalMoveSpeed = this.plugin.MOVE_SPEED_MIN + Math.random() * (this.plugin.MOVE_SPEED_MAX - this.plugin.MOVE_SPEED_MIN);
                    
                    entity.aiType = 'ZOMBIE';
                }
            }
            
            // Call original method
            aiManager.originalAddEntity(entity);
        };
        
        console.log(`[${this.plugin.name}] Patched AIManager.addEntity to handle both Human and Zombie NPCs separately.`);

        // Patch damage handling for humans specifically (ONLY LOOT BAG CREATION)
        this.patchHumanNpcDamage(server);

        // Enhanced run method that handles both AI types
        aiManager.run = () => {
            // Run original AI logic first
            if (aiManager.originalRun) {
                aiManager.originalRun();
            }
            
            // Run zombie AI if zombies exist
            if (aiManager.npcEntities && aiManager.npcEntities.size > 0) {
                this.runZombieAiTick(aiManager);
            }
            
            // Run human AI if humans exist
            if (aiManager.humanNpcEntities && aiManager.humanNpcEntities.size > 0) {
                this.runHumanAiTick(aiManager);
            }
        };
        
        console.log(`[${this.plugin.name}] Human AI is now fully active with separate processing.`);
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
        
        // Only patch if not already patched
        if (this.hasHookedDamage) {
            console.log(`[${plugin.name}] Damage already patched for humans...`);
            return;
        }
        
        // SIMPLIFIED: Only hook for loot bag creation
        const originalDamage = Npc.prototype.damage;
        if (!Npc.prototype.originalDamage) {
            Npc.prototype.originalDamage = originalDamage;
        }

        Npc.prototype.damage = async function(server, damageInfo) {
            let wasJustEnraged = false;
            let client = server.getClientByCharId(damageInfo.entity);
            if (!client) {
                const sourceEntity = server.getEntity(damageInfo.entity);
                if (sourceEntity instanceof ProjectileEntity) {
                    client = server.getClientByCharId(sourceEntity.managerCharacterId);
                }
            }

            // Store health info to detect death
            const willDie = (this.health - damageInfo.damage) <= 0 && this.isAlive;

            if (client) {
                if (this.isHumanNPC === true) {
                    // HUMAN NPC damage handling
                    if (this.personalAggroRadius < plugin.ENRAGED_AGGRO_RADIUS) {
                        console.log(`[${plugin.name}] Human NPC ${this.characterId} enraged!`);
                        this.personalAggroRadius = plugin.ENRAGED_AGGRO_RADIUS;
                        this.personalShootRadius = plugin.ENRAGED_SHOOT_RADIUS;
                        this.trackingRange = plugin.ENRAGED_AGGRO_RADIUS;
                        wasJustEnraged = true;
                    }
                } else {
                    // ZOMBIE NPC damage handling
                    if (this.personalAggroRadius < plugin.ENRAGED_AGGRO_RADIUS) {
                        this.personalAggroRadius = plugin.ENRAGED_AGGRO_RADIUS;
                        wasJustEnraged = true;
                    }
                }
            }
            
            // Call the original damage function
            const result = await originalDamage.apply(this, arguments);

            // SINGLE LOOT BAG: Only create loot bag if this is a human NPC that will die
            if (this.isHumanNPC === true && willDie && server.destroMOD && !this.lootBagCreated) {
                this.lootBagCreated = true; // Mark as processed
                console.log(`[${plugin.name}] Human NPC ${this.characterId} died - creating SINGLE loot bag...`);
                
                // Delay to ensure death is processed
                setTimeout(() => {
                    if (server.destroMOD && typeof server.destroMOD.createHumanNPCLootBag === 'function') {
                        server.destroMOD.createHumanNPCLootBag(server, this);
                    }
                }, 100); // Shorter delay
            }

            // Alert nearby NPCs
            if (wasJustEnraged) {
                if (this.isHumanNPC === true) {
                    humanAI.alertNearbyHumans(this, server);
                } else {
                    humanAI.alertNearbyZombies(this, server);
                }
            }

            return result;
        };

        this.hasHookedDamage = true;
        console.log(`[${plugin.name}] Patched damage system for SINGLE loot bag creation.`);
    }

    alertNearbyHumans(enragedHuman, server) {
        const aiManager = server.aiManager;
        const plugin = this.plugin;

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
                        otherNpc.personalAggroRadius = newAggroRadius;
                        otherNpc.personalShootRadius = newShootRadius;
                        otherNpc.trackingRange = newAggroRadius;
                    }
                }
            });
        }
    }

    alertNearbyZombies(enragedZombie, server) {
        const aiManager = server.aiManager;
        const plugin = this.plugin;

        if (aiManager.npcEntities) {
            aiManager.npcEntities.forEach((otherNpc) => {
                if (otherNpc.characterId === enragedZombie.characterId || !otherNpc.isAlive) {
                    return;
                }

                const distance = getDistance(enragedZombie.state.position, otherNpc.state.position);

                if (distance <= plugin.ALERT_RADIUS) {
                    const newAggroRadius = plugin.ALERTED_AGGRO_RADIUS_MIN + Math.random() * (plugin.ALERTED_AGGRO_RADIUS_MAX - plugin.ALERTED_AGGRO_RADIUS_MIN);
                    
                    if (otherNpc.personalAggroRadius < newAggroRadius) {
                        otherNpc.personalAggroRadius = newAggroRadius;
                    }
                }
            });
        }
    }

    // Standard AI methods (unchanged)
    runZombieAiTick(aiManager) {
        if (!aiManager.npcEntities) return;
        
        aiManager.npcEntities.forEach((npc) => {
            try {
                if (!npc || !npc.state || npc.aiType === 'HUMAN') { return; }
                if (npc.aiState === undefined) npc.aiState = 'IDLE';
                if (!npc.isAlive) {
                    if (npc.aiState !== 'IDLE') this.changeZombieState(npc, 'IDLE');
                    return;
                }
                const closestPlayer = this.findClosestPlayer(npc, aiManager);
                const newState = this.determineZombieState(npc, closestPlayer);
                if (npc.aiState !== newState) { this.changeZombieState(npc, newState); }
                this.executeZombieContinuousAction(npc, closestPlayer);
            } catch (e) {
                if (this.debugMode) {
                    console.error(`[${this.plugin.name}] Zombie AI tick failed for NPC ${npc.characterId || 'UNKNOWN'}:`, e);
                }
            }
        });
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
                
                if (npc.aiState !== newState) { 
                    this.changeHumanState(npc, newState); 
                }
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

    changeZombieState(npc, newState) {
        const oldState = npc.aiState || 'IDLE';
        if (oldState === newState) return;
        npc.aiState = newState;
        switch (newState) {
            case 'IDLE': this.executeStop(npc); npc.playAnimation("Idle"); break;
            case 'ATTACKING': this.executeStop(npc); break;
            case 'CHASING': npc.playAnimation("walk"); break;
        }
    }

    executeHumanContinuousAction(npc, target) {
        if (npc.aiState === 'CHASING' && target) { 
            this.executeMovement(npc, target); 
        }
        if (npc.aiState === 'SHOOTING' && target) { 
        npc.server.destroMOD.humanShoot.tryShoot(npc, target); 
        }
        
        if (target && npc.aiState !== 'IDLE') {
            const distance = getDistance(npc.state.position, target.state.position);
            const trackingRange = npc.trackingRange || npc.personalAggroRadius;
            
            if (distance <= trackingRange) {
                this.faceTarget(npc, target);
            }
        }
    }

    executeZombieContinuousAction(npc, target) {
        if (npc.aiState === 'CHASING' && target) { this.executeMovement(npc, target); }
        if (npc.aiState === 'ATTACKING' && target) { this.tryAttack(npc, target); }
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

    faceTarget(npc, target) {
        const now = Date.now();
        
        if (!npc.lastFaceUpdate) {
            npc.lastFaceUpdate = 0;
            npc.currentFacing = npc.state.orientation || 0;
            npc.comfortZone = 0.1;
        }
        
        if (now - npc.lastFaceUpdate < 100) { 
            return;
        }
        
        const dirX = target.state.position[0] - npc.state.position[0];
        const dirZ = target.state.position[2] - npc.state.position[2];
        const distance = Math.sqrt(dirX * dirX + dirZ * dirZ);
        
        if (distance < 0.5) {
            return;
        }
        
        const targetOrientation = Math.atan2(dirX, dirZ);
        const currentOrientation = npc.currentFacing;
        
        let angleDiff = targetOrientation - currentOrientation;
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        
        if (Math.abs(angleDiff) < npc.comfortZone) {
            return;
        }
        
        npc.lastFaceUpdate = now;
        
        let rotationSpeed = 0.25;
        let newOrientation;
        
        if (Math.abs(angleDiff) > 1.5) {
            newOrientation = targetOrientation;
        } else if (Math.abs(angleDiff) <= rotationSpeed) {
            newOrientation = targetOrientation;
        } else {
            if (Math.abs(angleDiff) > 0.8) {
                rotationSpeed = 0.4;
            }
            newOrientation = currentOrientation + (angleDiff > 0 ? rotationSpeed : -rotationSpeed);
        }
        
        while (newOrientation > Math.PI) newOrientation -= 2 * Math.PI;
        while (newOrientation < -Math.PI) newOrientation += 2 * Math.PI;
        
        npc.currentFacing = newOrientation;
        this.sendMovementPacket(npc, newOrientation, 0);
    }

    tryAttack(npc, target) {
        const now = Date.now();
        const canAttackAt = this.plugin.attackCooldowns.get(npc.characterId) || 0;
        if (now >= canAttackAt) {
            const randomCooldown = randomIntFromInterval(this.plugin.ATTACK_COOLDOWN_MIN_MS, this.plugin.ATTACK_COOLDOWN_MAX_MS);
            this.plugin.attackCooldowns.set(npc.characterId, now + randomCooldown);
            this.faceTarget(npc, target);
            npc.playAnimation("GrappleTell");
            const client = npc.server.getClientByCharId(target.characterId);
            if (client) {
                const { MeleeTypes } = require(path.join(serverModulePath, 'out/servers/ZoneServer2016/models/enums'));
                client.character.OnMeleeHit(npc.server, {
                    entity: npc.characterId, weapon: 0, damage: npc.npcMeleeDamage, causeBleed: false, meleeType: MeleeTypes.FISTS,
                    hitReport: { sessionProjectileCount: 0, characterId: target.characterId, position: target.state.position, unknownFlag1: 0, unknownByte2: 0, totalShotCount: 0, hitLocation: "TORSO" }
                });
            }
        }
    }

    getDirectionTo(npc, target) {
        const dx = target.state.position[0] - npc.state.position[0];
        const dz = target.state.position[2] - npc.state.position[2];
        const distance = Math.sqrt(dx * dx + dz * dz);
        return distance > 0 ? [dx / distance, 0, dz / distance] : [0, 0, 1];
    }

    executeStop(npc) {
        if (npc.lastSentSpeed !== 0) { 
            this.sendMovementPacket(npc, npc.state.orientation, 0); 
        }
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

    determineHumanState(npc, player) {
        if (!player) return 'IDLE';
        
        const distance = getDistance(npc.state.position, player.state.position);
        const verticalDistance = Math.abs(npc.state.position[1] - player.state.position[1]);
        const shootRadius = npc.personalShootRadius || this.plugin.SHOOT_RADIUS_MAX;
        const aggroRadius = npc.personalAggroRadius || this.plugin.AGGRO_RADIUS_MAX;
        
        if (verticalDistance > this.plugin.MAX_VERTICAL_AGGRO_DISTANCE) { 
            return 'IDLE'; 
        }
        
        if (distance > aggroRadius) {
            return 'IDLE';
        }
        
        if (distance <= shootRadius) {
            return 'SHOOTING';
        } else {
            return 'CHASING';
        }
    }

    determineZombieState(npc, player) {
        if (!player) return 'IDLE';
        const distance = getDistance(npc.state.position, player.state.position);
        const verticalDistance = Math.abs(npc.state.position[1] - player.state.position[1]);
        const attackRadius = npc.personalAttackRadius || this.plugin.ATTACK_RADIUS_MAX;
        const aggroRadius = npc.personalAggroRadius || this.plugin.AGGRO_RADIUS_MAX;
        
        if (verticalDistance > this.plugin.MAX_VERTICAL_AGGRO_DISTANCE) { 
            return 'IDLE'; 
        }
        if (distance <= attackRadius) return 'ATTACKING';
        if (distance <= aggroRadius) return 'CHASING';
        return 'IDLE';
    }
}

module.exports = HumanAI;