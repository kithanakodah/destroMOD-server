// ========================================
// Human NPC AI - FINAL (Corrected Logic)
// Controls both Human and Zombie AI logic with independent loops.
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
        const aiManager = server.aiManager;
        if (!aiManager) return;

        aiManager.humanNpcEntities = new Set();
        
        if (!aiManager.originalAddEntity) aiManager.originalAddEntity = aiManager.addEntity.bind(aiManager);
        if (!aiManager.originalRun) aiManager.originalRun = aiManager.run.bind(aiManager);
        
        aiManager.addEntity = (entity) => {
            if (entity instanceof Npc) {
                if (entity.isHumanNPC) {
                    aiManager.humanNpcEntities.add(entity);
                    entity.personalShootRadius = this.plugin.SHOOT_RADIUS_MIN + Math.random() * (this.plugin.SHOOT_RADIUS_MAX - this.plugin.SHOOT_RADIUS_MIN);
                    entity.weapon = this.assignRandomWeapon();
                    entity.aiType = 'HUMAN';
                } else {
                    if (!aiManager.npcEntities) aiManager.npcEntities = new Set();
                    aiManager.npcEntities.add(entity);
                    entity.personalAttackRadius = this.plugin.ATTACK_RADIUS_MIN + Math.random() * (this.plugin.ATTACK_RADIUS_MAX - this.plugin.ATTACK_RADIUS_MIN);
                    entity.aiType = 'ZOMBIE';
                }
                entity.personalAggroRadius = this.plugin.AGGRO_RADIUS_MIN + Math.random() * (this.plugin.AGGRO_RADIUS_MAX - this.plugin.AGGRO_RADIUS_MIN);
                entity.personalMoveSpeed = this.plugin.MOVE_SPEED_MIN + Math.random() * (this.plugin.MOVE_SPEED_MAX - this.plugin.MOVE_SPEED_MIN);
                entity.wasAggroed = false;
            }
            aiManager.originalAddEntity(entity);
        };
        
        this.patchNpcDamage(server);

        aiManager.run = () => {
            aiManager.originalRun();
            this.runZombieAiTick(aiManager);
            this.runHumanAiTick(aiManager);
        };
    }

    assignRandomWeapon() {
        const weapons = [ Items.WEAPON_AR15, Items.WEAPON_AK47 ];
        return weapons[Math.floor(Math.random() * weapons.length)];
    }

    patchNpcDamage(server) {
        const plugin = this.plugin;
        const humanAI = this;
        
        const originalDamage = Npc.prototype.damage;
        Npc.prototype.damage = async function(server, damageInfo) {
            let wasJustEnraged = false;
            const sourceEntity = server.getEntity(damageInfo.entity);
            const client = server.getClientByCharId(damageInfo.entity) || 
                           (sourceEntity instanceof ProjectileEntity ? server.getClientByCharId(sourceEntity.managerCharacterId) : null);

            const willDie = (this.health - damageInfo.damage) <= 0 && this.isAlive;

            if (client && this.personalAggroRadius < plugin.ENRAGED_AGGRO_RADIUS) {
                this.personalAggroRadius = plugin.ENRAGED_AGGRO_RADIUS;
                if(this.isHumanNPC) this.personalShootRadius = plugin.ENRAGED_SHOOT_RADIUS;
                wasJustEnraged = true;
            }
            
            const result = await originalDamage.apply(this, arguments);

            if (willDie && this.wasAggroed) {
                plugin.pathfinding.removeAggroedNPC(this);
                this.wasAggroed = false;
            }

            if (this.isHumanNPC && willDie && !this.lootBagCreated) {
                this.lootBagCreated = true;
                setTimeout(() => plugin.createHumanNPCLootBag(server, this), 100);
            }

            if (wasJustEnraged) {
                if (this.isHumanNPC) humanAI.alertNearbyHumans(this, server);
                else humanAI.alertNearbyZombies(this, server);
            }

            return result;
        };
    }

    alertNearbyHumans(enragedHuman, server) {
        server.aiManager.humanNpcEntities.forEach(npc => {
            if (npc.characterId === enragedHuman.characterId || !npc.isAlive) return;
            if (getDistance(enragedHuman.state.position, npc.state.position) <= this.plugin.ALERT_RADIUS) {
                const newAggro = this.plugin.ALERTED_AGGRO_RADIUS_MIN + Math.random() * (this.plugin.ALERTED_AGGRO_RADIUS_MAX - this.plugin.ALERTED_AGGRO_RADIUS_MIN);
                if (npc.personalAggroRadius < newAggro) npc.personalAggroRadius = newAggro;
            }
        });
    }

    alertNearbyZombies(enragedZombie, server) {
        server.aiManager.npcEntities.forEach(npc => {
            if (npc.characterId === enragedZombie.characterId || !npc.isAlive) return;
            if (getDistance(enragedZombie.state.position, npc.state.position) <= this.plugin.ALERT_RADIUS) {
                const newAggro = this.plugin.ALERTED_AGGRO_RADIUS_MIN + Math.random() * (this.plugin.ALERTED_AGGRO_RADIUS_MAX - this.plugin.ALERTED_AGGRO_RADIUS_MIN);
                if (npc.personalAggroRadius < newAggro) npc.personalAggroRadius = newAggro;
            }
        });
    }

    manageAggroState(npc, newState) {
        const isNowAggro = newState === 'CHASING' || newState === 'ATTACKING' || newState === 'SHOOTING';
        
        if (npc.wasAggroed !== isNowAggro) {
            if (isNowAggro) {
                if (this.plugin.pathfinding.addAggroedNPC(npc)) npc.wasAggroed = true;
            } else {
                this.plugin.pathfinding.removeAggroedNPC(npc);
                npc.wasAggroed = false;
            }
        }
    }
    
    runZombieAiTick(aiManager) {
    if (!aiManager.npcEntities) return;
    aiManager.npcEntities.forEach(npc => {
        try {
            if (!npc || !npc.state || npc.aiType !== 'ZOMBIE') return;

            if (!npc.isAlive) {
                // Simplified - pathfinding.update() now handles cleanup
                if (npc.aiState !== 'IDLE') this.changeZombieState(npc, 'IDLE');
                return;
            }
            
            if (npc.aiState === undefined) npc.aiState = 'IDLE';
            
            const closestPlayer = this.findClosestPlayer(npc, aiManager);
            const newState = this.determineZombieState(npc, closestPlayer);
            
            this.manageAggroState(npc, newState);
            
            if (npc.aiState !== newState) {
                this.changeZombieState(npc, newState);
            }
            
            this.executeZombieContinuousAction(npc, closestPlayer);
        } catch (e) {
            console.error(`Zombie AI tick failed for ${npc.characterId}:`, e);
            if (npc.wasAggroed) this.plugin.pathfinding.removeAggroedNPC(npc);
        }
    });
}

    runHumanAiTick(aiManager) {
        if (!aiManager.humanNpcEntities) return;
        aiManager.humanNpcEntities.forEach(npc => {
            try {
                if (!npc || !npc.state || npc.aiType !== 'HUMAN') return;

                if (!npc.isAlive) {
                    if (npc.wasAggroed) this.plugin.pathfinding.removeAggroedNPC(npc);
                    if (npc.aiState !== 'IDLE') this.changeHumanState(npc, 'IDLE');
                    return;
                }
                
                if (npc.aiState === undefined) npc.aiState = 'IDLE';
                
                const closestPlayer = this.findClosestPlayer(npc, aiManager);
                const newState = this.determineHumanState(npc, closestPlayer);
                
                this.manageAggroState(npc, newState);
                
                if (npc.aiState !== newState) {
                    this.changeHumanState(npc, newState);
                }
                
                this.executeHumanContinuousAction(npc, closestPlayer);
            } catch (e) {
                console.error(`Human AI tick failed for ${npc.characterId}:`, e);
                if (npc.wasAggroed) this.plugin.pathfinding.removeAggroedNPC(npc);
            }
        });
    }

    changeHumanState(npc, newState) {
        if (npc.aiState === newState) return;
        npc.aiState = newState;
        switch (newState) {
            case 'IDLE': this.executeStop(npc); npc.playAnimation("Idle"); break;
            case 'SHOOTING': this.executeStop(npc); npc.playAnimation("Combat_Rifle_Aim"); break;
            case 'CHASING': npc.playAnimation("walk"); break;
        }
    }

    changeZombieState(npc, newState) {
        if (npc.aiState === newState) return;
        npc.aiState = newState;
        switch (newState) {
            case 'IDLE': 
                this.executeStop(npc); 
                npc.playAnimation("Idle");
                break;
            case 'ATTACKING': 
                this.executeStop(npc, true); // allow slow following when attacking
                break;
            case 'CHASING': 
                npc.playAnimation("walk");
                break;
        }
    }

    executeHumanContinuousAction(npc, target) {
        if (!target) return;
        if (npc.aiState === 'CHASING') this.executeMovement(npc, target); 
        if (npc.aiState === 'SHOOTING') npc.server.destroMOD.humanShoot.tryShoot(npc, target); 
        this.faceTarget(npc, target);
    }
    
    executeZombieContinuousAction(npc, target) {
        if (!target) return;

        if (npc.aiState === 'CHASING') {
            this.executeMovement(npc, target);
            this.faceTarget(npc, target);
        }
        else if (npc.aiState === 'ATTACKING') {
            this.tryAttack(npc, target);
        }
    }

    executeMovement(npc, target) {
        if (!target || !target.state.position) return this.executeStop(npc);
        
        if (this.plugin.pathfinding.isReady && npc.wasAggroed) {
            const now = Date.now();
            if (!npc.lastPathfindTime || now - npc.lastPathfindTime > 25) { // changed to 25ms 
                npc.lastPathfindTime = now;
                this.plugin.pathfinding.setNPCTarget(npc.characterId, target.state.position);
            }
        }
    }

    faceTarget(npc, target) {
        if (!target) return;
        const now = Date.now();
        if (npc.lastFaceUpdate && now - npc.lastFaceUpdate < 100) return;
        const dirX = target.state.position[0] - npc.state.position[0];
        const dirZ = target.state.position[2] - npc.state.position[2];
        const orientation = Math.atan2(dirX, dirZ);
        npc.lastFaceUpdate = now;
        this.sendMovementPacket(npc, orientation, npc.lastSentSpeed || 0);
    }

    tryAttack(npc, target) {
        const now = Date.now();
        const canAttackAt = this.plugin.attackCooldowns.get(npc.characterId) || 0;
        if (now < canAttackAt) return;

        const attackRadius = npc.personalAttackRadius || this.plugin.ATTACK_RADIUS_MAX;
        if (getDistance(npc.state.position, target.state.position) > attackRadius) {
            // Important: Do not attack if player moved out of range.
            // The AI will switch back to CHASING on the next tick automatically.
            return;
        }

        const randomCooldown = randomIntFromInterval(this.plugin.ATTACK_COOLDOWN_MIN_MS, this.plugin.ATTACK_COOLDOWN_MAX_MS);
        this.plugin.attackCooldowns.set(npc.characterId, now + randomCooldown);
        this.faceTarget(npc, target);
        npc.playAnimation("GrappleTell");
        
        const client = npc.server.getClientByCharId(target.characterId);
        if (client) {
            const { MeleeTypes } = require(path.join(serverModulePath, 'out/servers/ZoneServer2016/models/enums'));
            client.character.OnMeleeHit(npc.server, {
                entity: npc.characterId, weapon: 0, damage: npc.npcMeleeDamage, causeBleed: false, meleeType: MeleeTypes.FISTS,
                hitReport: { characterId: target.characterId, position: target.state.position }
            });
        }
    }

    executeStop(npc, allowSlowFollow = false) {
    if (this.plugin.pathfinding.isReady && npc.wasAggroed) {
        if (allowSlowFollow) {
            // Don't fully stop pathfinding, just slow it way down
            // This keeps them following but very slowly
        } else {
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
                position: npc.state.position, unknown3_int8: 0, stance: 66565, engineRPM: 0, 
                orientation: orientation, frontTilt: 0, sideTilt: 0, angleChange: 0, 
                verticalSpeed: 0, horizontalSpeed: speed
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
                if (this.plugin.pathfinding && this.plugin.pathfinding.hasLineOfSight) {
                    const hasLOS = this.plugin.pathfinding.hasLineOfSight(npc.state.position, player.state.position);
                    if (!hasLOS) return;
                }
                minDistance = distance;
                closestPlayer = player;
            }
        });
        return closestPlayer;
    }

    determineHumanState(npc, player) {
        if (!player) return 'IDLE';
        const distance = getDistance(npc.state.position, player.state.position);
        if (distance > npc.personalAggroRadius) return 'IDLE';
        if (distance <= npc.personalShootRadius) return 'SHOOTING';
        return 'CHASING';
    }

    determineZombieState(npc, player) {
        if (!player) return 'IDLE';
        const distance = getDistance(npc.state.position, player.state.position);
        const attackRadius = npc.personalAttackRadius || this.plugin.ATTACK_RADIUS_MAX;
        const aggroRadius = npc.personalAggroRadius || this.plugin.AGGRO_RADIUS_MAX;
        
        if (distance > aggroRadius) return 'IDLE';
        if (distance <= attackRadius) return 'ATTACKING';
        return 'CHASING';
    }
}

module.exports = HumanAI;