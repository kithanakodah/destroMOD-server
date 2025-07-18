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
    }

    startup(server) {
        console.log(`[${this.plugin.name}] Starting Zombie AI initialization...`);
        const aiManager = server.aiManager;
        if (!aiManager) return console.error(`[${this.plugin.name}] FATAL: Could not find AIManager.`);

        aiManager.npcEntities = new Set();
        const originalAddEntity = aiManager.addEntity.bind(aiManager);
        aiManager.addEntity = (entity) => {
            if (entity instanceof Npc) {
                aiManager.npcEntities.add(entity);
                entity.personalAttackRadius = this.plugin.ATTACK_RADIUS_MIN + Math.random() * (this.plugin.ATTACK_RADIUS_MAX - this.plugin.ATTACK_RADIUS_MIN);
                entity.personalAggroRadius = this.plugin.AGGRO_RADIUS_MIN + Math.random() * (this.plugin.AGGRO_RADIUS_MAX - this.plugin.AGGRO_RADIUS_MIN);
                entity.personalMoveSpeed = this.plugin.MOVE_SPEED_MIN + Math.random() * (this.plugin.MOVE_SPEED_MAX - this.plugin.MOVE_SPEED_MIN);
            }
            originalAddEntity(entity);
        };
        console.log(`[${this.plugin.name}] Patched AIManager to handle NPC entities.`);

        this.patchNpcDamage(server);

        const originalRun = aiManager.run.bind(aiManager);
        aiManager.run = () => {
            originalRun();
            this.runAiTick(aiManager);
        };
        console.log(`[${this.plugin.name}] Zombie AI is now fully active.`);
    }

    patchNpcDamage(server) {
        const plugin = this.plugin;
        const zombieAI = this; // Capture the 'this' context of the ZombieAI instance for use inside the patch
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

            if (client) {
                if (this.personalAggroRadius < plugin.ENRAGED_AGGRO_RADIUS) {
                    console.log(`[${plugin.name}] NPC ${this.characterId} enraged by player! New aggro radius: ${plugin.ENRAGED_AGGRO_RADIUS}`);
                    this.personalAggroRadius = plugin.ENRAGED_AGGRO_RADIUS;
                    wasJustEnraged = true; // Flag that this was the moment it got enraged
                }
            }
            
            // Call the original damage function first
            const result = await originalDamage.apply(this, arguments);

            // If the zombie was just enraged by the damage, it "shouts" for help
            if (wasJustEnraged) {
                zombieAI.alertNearbyZombies(this, server);
            }

            return result;
        };

        console.log(`[${plugin.name}] Patched Npc.damage to handle aggro and alerts.`);
    }

    // --- NEW FUNCTION TO ALERT OTHER ZOMBIES ---
    alertNearbyZombies(enragedZombie, server) {
        const aiManager = server.aiManager;
        const plugin = this.plugin;

        console.log(`[${plugin.name}] Enraged zombie ${enragedZombie.characterId} is alerting others within ${plugin.ALERT_RADIUS} units.`);

        aiManager.npcEntities.forEach((otherNpc) => {
            // Ensure the other NPC is not itself and is currently alive
            if (otherNpc.characterId === enragedZombie.characterId || !otherNpc.isAlive) {
                return;
            }

            const distance = getDistance(enragedZombie.state.position, otherNpc.state.position);

            // If the other NPC is within the alert radius...
            if (distance <= plugin.ALERT_RADIUS) {
                const newAggroRadius = plugin.ALERTED_AGGRO_RADIUS_MIN + Math.random() * (plugin.ALERTED_AGGRO_RADIUS_MAX - plugin.ALERTED_AGGRO_RADIUS_MIN);
                
                // Only increase the aggro radius. Never decrease it.
                // This prevents an already enraged zombie from getting a smaller radius.
                if (otherNpc.personalAggroRadius < newAggroRadius) {
                    console.log(`[${plugin.name}] NPC ${enragedZombie.characterId} alerted nearby NPC ${otherNpc.characterId}! New aggro: ${newAggroRadius.toFixed(2)}`);
                    otherNpc.personalAggroRadius = newAggroRadius;
                }
            }
        });
    }

    runAiTick(aiManager) {
        aiManager.npcEntities.forEach((npc) => {
            try {
                if (!npc || !npc.state) { return; }
                if (npc.aiState === undefined) npc.aiState = 'IDLE';
                if (!npc.isAlive) {
                    if (npc.aiState !== 'IDLE') this.changeState(npc, 'IDLE');
                    return;
                }
                const closestPlayer = this.findClosestPlayer(npc, aiManager);
                const newState = this.determineState(npc, closestPlayer);
                if (npc.aiState !== newState) { this.changeState(npc, newState); }
                this.executeContinuousAction(npc, closestPlayer);
            } catch (e) {
                console.error(`[${this.plugin.name}] AI tick failed for NPC ${npc.characterId || 'UNKNOWN'}:`, e);
            }
        });
    }

    changeState(npc, newState) {
        const oldState = npc.aiState || 'IDLE';
        if (oldState === newState) return;
        npc.aiState = newState;
        switch (newState) {
            case 'IDLE': this.executeStop(npc); npc.playAnimation("Idle"); break;
            case 'ATTACKING': this.executeStop(npc); break;
            case 'CHASING': npc.playAnimation("walk"); break;
        }
    }

    executeContinuousAction(npc, target) {
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
                    entity: npc.characterId, weapon: 0, damage: npc.npcMeleeDamage, causeBleed: false, meleeType: MeleeTypes.FISTS,
                    hitReport: { sessionProjectileCount: 0, characterId: target.characterId, position: target.state.position, unknownFlag1: 0, unknownByte2: 0, totalShotCount: 0, hitLocation: "TORSO" }
                });
            }
        }
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
                sequenceTime: getCurrentServerTimeWrapper().getTruncatedU32(), position: npc.state.position,
                unknown3_int8: 0, stance: 66565, engineRPM: 0, orientation: orientation,
                frontTilt: 0, sideTilt: 0, angleChange: 0, verticalSpeed: 0, horizontalSpeed: speed
            }
        });
    }

    faceTarget(npc, target) {
        const dirX = target.state.position[0] - npc.state.position[0];
        const dirZ = target.state.position[2] - npc.state.position[2];
        const orientation = Math.atan2(dirX, dirZ);
        this.sendMovementPacket(npc, orientation, 0);
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

    determineState(npc, player) {
        if (!player) return 'IDLE';
        const distance = getDistance(npc.state.position, player.state.position);
        const verticalDistance = Math.abs(npc.state.position[1] - player.state.position[1]);
        const attackRadius = npc.personalAttackRadius || this.plugin.ATTACK_RADIUS_MAX;
        const aggroRadius = npc.personalAggroRadius || this.plugin.AGGRO_RADIUS_MAX;
        if (verticalDistance > this.plugin.MAX_VERTICAL_AGGRO_DISTANCE) { return 'IDLE'; }
        if (distance <= attackRadius) return 'ATTACKING';
        if (distance <= aggroRadius) return 'CHASING';
        return 'IDLE';
    }
}

module.exports = ZombieAI;