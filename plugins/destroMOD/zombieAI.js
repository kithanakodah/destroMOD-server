"use strict";

const path = require('path');
const serverModulePath = path.join(process.cwd(), 'node_modules/h1z1-server');
const { getDistance, getCurrentServerTimeWrapper, randomIntFromInterval } = require(path.join(serverModulePath, 'out/utils/utils'));
const { Npc } = require(path.join(serverModulePath, 'out/servers/ZoneServer2016/entities/npc'));
const { ProjectileEntity } = require(path.join(serverModulePath, 'out/servers/ZoneServer2016/entities/projectileentity'));
const { MeleeTypes } = require(path.join(serverModulePath, 'out/servers/ZoneServer2016/models/enums'));

class ZombieAI {
    constructor(plugin) {
        this.plugin = plugin;
        this.debugMode = false;
        this.zombieCount = 0;
    }

    startup(server) {
        console.log(`[${this.plugin.name}] Starting Zombie AI initialization...`);
        const aiManager = server.aiManager;
        if (!aiManager) return console.error(`[${this.plugin.name}] FATAL: Could not find AIManager.`);

        if (!aiManager.npcEntities) {
            aiManager.npcEntities = new Set();
        }
        
        // This patch is now centrally handled in humanAI.js to avoid race conditions.
        // If humanAI hasn't loaded, this will set up a basic version.
        if (!aiManager.originalAddEntity) {
            console.log(`[${this.plugin.name}] Setting up zombie AI addEntity (human AI not loaded yet)`);
            
            const originalAddEntity = aiManager.addEntity.bind(aiManager);
            aiManager.originalAddEntity = originalAddEntity;
            
            aiManager.addEntity = (entity) => {
                if (entity instanceof Npc) {
                    if (entity.isHumanNPC !== true) {
                        aiManager.npcEntities.add(entity);
                        
                        entity.personalAttackRadius = this.plugin.ATTACK_RADIUS_MIN + Math.random() * (this.plugin.ATTACK_RADIUS_MAX - this.plugin.ATTACK_RADIUS_MIN);
                        entity.personalAggroRadius = this.plugin.AGGRO_RADIUS_MIN + Math.random() * (this.plugin.AGGRO_RADIUS_MAX - this.plugin.AGGRO_RADIUS_MIN);
                        entity.personalMoveSpeed = this.plugin.MOVE_SPEED_MIN + Math.random() * (this.plugin.MOVE_SPEED_MAX - this.plugin.MOVE_SPEED_MIN);
                        
                        entity.aiType = 'ZOMBIE';
                        this.zombieCount++;
                        
                        if (this.zombieCount % 50 === 0) {
                            console.log(`[${this.plugin.name}] Configured ${this.zombieCount} zombie NPCs...`);
                        }
                    }
                }
                originalAddEntity(entity);
            };
        } else {
            console.log(`[${this.plugin.name}] Human AI already set up addEntity, zombie AI will cooperate`);
        }
        
        console.log(`[${this.plugin.name}] Zombie AI addEntity setup complete.`);

        // REMOVED: The Npc.prototype.damage patch is now applied centrally in humanAI.js
        // to handle both humans and zombies in one place and prevent errors.

        // This ensures the zombie AI tick is called from the central run loop in humanAI.js
        if (aiManager.originalRun) {
            console.log(`[${this.plugin.name}] Human AI already set up run method, zombie AI will be called from there`);
        }
        
        setTimeout(() => {
            console.log(`[${this.plugin.name}] Zombie AI fully active with ${this.zombieCount} zombie NPCs configured.`);
        }, 2000);
    }

    alertNearbyZombies(enragedZombie, server) {
        const aiManager = server.aiManager;
        const plugin = this.plugin;

        if (!this.hasLoggedAlert || this.hasLoggedAlert < 3) {
            console.log(`[${plugin.name}] Enraged zombie ${enragedZombie.characterId} is alerting other zombies within ${plugin.ALERT_RADIUS} units.`);
            this.hasLoggedAlert = (this.hasLoggedAlert || 0) + 1;
        }

        if (aiManager.npcEntities) {
            let alertedCount = 0;
            aiManager.npcEntities.forEach((otherNpc) => {
                if (otherNpc.characterId === enragedZombie.characterId || !otherNpc.isAlive || otherNpc.isHumanNPC === true) {
                    return;
                }

                const distance = getDistance(enragedZombie.state.position, otherNpc.state.position);

                if (distance <= plugin.ALERT_RADIUS) {
                    const newAggroRadius = plugin.ALERTED_AGGRO_RADIUS_MIN + Math.random() * (plugin.ALERTED_AGGRO_RADIUS_MAX - plugin.ALERTED_AGGRO_RADIUS_MIN);
                    
                    if (otherNpc.personalAggroRadius < newAggroRadius) {
                        otherNpc.personalAggroRadius = newAggroRadius;
                        alertedCount++;
                    }
                }
            });
            
            if (alertedCount > 0 && (!this.hasLoggedAlertSummary || this.hasLoggedAlertSummary < 2)) {
                console.log(`[${plugin.name}] Zombie ${enragedZombie.characterId} alerted ${alertedCount} nearby zombies`);
                this.hasLoggedAlertSummary = (this.hasLoggedAlertSummary || 0) + 1;
            }
        }
    }

    runAiTick(aiManager) {
        if (!aiManager.npcEntities) return;
        
        const activeAgents = this.plugin.pathfinding.agents;
        if (!activeAgents) return;

        aiManager.npcEntities.forEach((npc) => {
            if (!activeAgents.has(npc.characterId)) return;

            try {
                if (!npc || !npc.state || npc.isHumanNPC === true) return;
                
                if (npc.aiState === undefined) npc.aiState = 'IDLE';
                if (!npc.isAlive) {
                    if (npc.aiState !== 'IDLE') this.changeState(npc, 'IDLE');
                    return;
                }
                
                const closestPlayer = this.findClosestPlayer(npc, aiManager);
                const newState = this.determineState(npc, closestPlayer);
                
                if (npc.aiState !== newState) { 
                    this.changeState(npc, newState); 
                }
                this.executeContinuousAction(npc, closestPlayer);
            } catch (e) {
                if (this.debugMode) {
                    console.error(`[${this.plugin.name}] Zombie AI tick failed for NPC ${npc.characterId || 'UNKNOWN'}:`, e);
                }
            }
        });
    }

    changeState(npc, newState) {
        const oldState = npc.aiState || 'IDLE';
        if (oldState === newState) return;
        
        npc.aiState = newState;
        
        switch (newState) {
            case 'IDLE': 
                this.executeStop(npc); 
                npc.playAnimation("Idle"); 
                break;
            case 'ATTACKING': 
                this.executeStop(npc); 
                break;
            case 'CHASING': 
                npc.playAnimation("walk"); 
                break;
        }
    }

    executeContinuousAction(npc, target) {
        if (npc.aiState === 'CHASING' && target) { 
            this.executeMovement(npc, target); 
        }
        if (npc.aiState === 'ATTACKING' && target) { 
            this.tryAttack(npc, target); 
        }
    }

    executeMovement(npc, target) {
        if (!target) {
            this.executeStop(npc);
            return;
        }

        if (this.plugin.pathfinding && this.plugin.pathfinding.isReady) {
            if (this.plugin.pathfinding.agents.has(npc.characterId)) {
                const now = Date.now();
                if (!npc.lastPathfindTime || now - npc.lastPathfindTime > 1000) {
                    npc.lastPathfindTime = now;
                    this.plugin.pathfinding.setNPCTarget(npc.characterId, target.state.position);
                }
            }
        }
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
                client.character.OnMeleeHit(npc.server, {
                    entity: npc.characterId, 
                    weapon: 0, 
                    damage: npc.npcMeleeDamage, 
                    causeBleed: false, 
                    meleeType: MeleeTypes.FISTS,
                    hitReport: { 
                        sessionProjectileCount: 0, 
                        characterId: target.characterId, 
                        position: target.state.position, 
                        unknownFlag1: 0, 
                        unknownByte2: 0, 
                        totalShotCount: 0, 
                        hitLocation: "TORSO" 
                    }
                });
                
                if (!this.hasLoggedAttack || this.hasLoggedAttack < 3) {
                    console.log(`[${this.plugin.name}] Zombie ${npc.characterId} attacked ${target.characterId} for ${npc.npcMeleeDamage} damage`);
                    this.hasLoggedAttack = (this.hasLoggedAttack || 0) + 1;
                }
            }
        }
    }

    executeStop(npc) {
        if (this.plugin.pathfinding && this.plugin.pathfinding.isReady) {
            if (this.plugin.pathfinding.agents.has(npc.characterId)) {
                this.plugin.pathfinding.stopNPC(npc.characterId);
            }
        }
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

    faceTarget(npc, target) {
        const dirX = target.state.position[0] - npc.state.position[0];
        const dirZ = target.state.position[2] - npc.state.position[2];
        const orientation = Math.atan2(dirX, dirZ);
        this.sendMovementPacket(npc, orientation, 0);
    }

    // In humanAI.js and zombieAI.js, update findClosestPlayer:
findClosestPlayer(npc, aiManager) {
    const aggroRadius = npc.personalAggroRadius || this.plugin.AGGRO_RADIUS_MAX;
    let closestPlayer = null;
    let minDistance = aggroRadius;
    const now = Date.now();
    
    aiManager.playerEntities.forEach((player) => {
        if (!player.isAlive) return;
        
        // Quick grace period check
        if (player.gameReadyTime && now - player.gameReadyTime < 10000) return;
        
        const distance = getDistance(npc.state.position, player.state.position);
        if (distance <= minDistance) {
            // Check line of sight before considering this player
            if (this.plugin.pathfinding && this.plugin.pathfinding.hasLineOfSight) {
                const hasLOS = this.plugin.pathfinding.hasLineOfSight(npc.state.position, player.state.position);
                if (!hasLOS) {
                    return; // Skip this player - no line of sight
                }
            }
            
            minDistance = distance;
            closestPlayer = player;
        }
    });
    return closestPlayer;
}

    determineState(npc, player) {
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

module.exports = ZombieAI;