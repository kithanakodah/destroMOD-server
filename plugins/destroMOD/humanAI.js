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
         this.patchNpcSerialization(server);

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
    patchNpcSerialization(server) {
        console.log(`[${this.plugin.name}] Patching NPC serialization to use PC animation system...`);

        // This is the function we are replacing
        const originalOnFullCharacterDataRequest = Npc.prototype.OnFullCharacterDataRequest;

        // Overwrite the original function with our new one
        Npc.prototype.OnFullCharacterDataRequest = function(server, client) {
            // NOTE: 'this' inside this function correctly refers to the NPC instance.

            // Send the "LightweightToFullPc" packet to trick the client
            // into using its advanced, velocity-driven animation system.
            server.sendData(client, "LightweightToFullPc", {
                useCompression: false,
                fullPcData: {
                    transientId: this.transientId,
                    attachmentData: [],
                    headActor: this.headActor, // Make sure your NPC class has this property
                    resources: { data: this.pGetResources() },
                    remoteWeapons: { data: [] }
                },
                positionUpdate: {
                    sequenceTime: 0,
                    position: this.state.position
                },
                stats: [],
                remoteWeaponsExtra: []
            });
            
            // Handle the one-time callback
            if (this.onReadyCallback) {
                this.onReadyCallback(client);
                delete this.onReadyCallback;
            }
        };
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

    // New, cleaner version
    changeHumanState(npc, newState) {
        if (npc.aiState === newState) return;

        console.log(`[AI-STATE] Human NPC ${npc.characterId} state change: ${npc.aiState || 'UNDEFINED'} -> ${newState}`);
        npc.aiState = newState;
        
        switch (newState) {
            case 'IDLE': this.executeStop(npc); npc.playAnimation("Idle"); break;
            case 'SHOOTING': this.executeStop(npc); npc.playAnimation("Combat_Rifle_Aim"); break;
            case 'CHASING': npc.playAnimation("walk"); break;
        }
    }

    changeZombieState(npc, newState) {
        if (npc.aiState === newState) return;

        console.log(`[AI-STATE] Zombie NPC ${npc.characterId} state change: ${npc.aiState || 'UNDEFINED'} -> ${newState}`);
        npc.aiState = newState;
        
        switch (newState) {
            case 'IDLE': 
                this.executeStop(npc); 
                break;
            case 'ATTACKING': 
                this.plugin.pathfinding.forceStopNPC(npc.characterId);
                break;
            case 'CHASING': 
                // No specific action needed, movement is handled by the continuous action loop
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
            if (!npc.lastPathfindTime || now - npc.lastPathfindTime > 100) { // changed to 200ms, may need to lower a bit
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
        this.sendMovementPacket(npc, orientation, npc.lastSentSpeed || 0, 0);
    }

    tryAttack(npc, target) {
    const now = Date.now();
    const canAttackAt = this.plugin.attackCooldowns.get(npc.characterId) || 0;
    if (now < canAttackAt) return;

    // === COMPREHENSIVE DEBUG LOGGING ===
    console.log(`\n[ATTACK_DEBUG] ==================== NPC ${npc.characterId} Attack Attempt ====================`);
    console.log(`[ATTACK_DEBUG] Timestamp: ${new Date(now).toISOString()}`);
    console.log(`[ATTACK_DEBUG] NPC Position: [${npc.state.position[0].toFixed(3)}, ${npc.state.position[1].toFixed(3)}, ${npc.state.position[2].toFixed(3)}]`);
    console.log(`[ATTACK_DEBUG] NPC AI State: ${npc.aiState}`);
    console.log(`[ATTACK_DEBUG] NPC wasAggroed: ${npc.wasAggroed}`);
    console.log(`[ATTACK_DEBUG] NPC in pathfinding crowd: ${this.plugin.pathfinding?.agents?.has(npc.characterId) || false}`);

    // Debug the target parameter (potentially stale)
    if (target && target.state && target.state.position) {
        console.log(`[ATTACK_DEBUG] Target param position: [${target.state.position[0].toFixed(3)}, ${target.state.position[1].toFixed(3)}, ${target.state.position[2].toFixed(3)}]`);
        console.log(`[ATTACK_DEBUG] Target characterId: ${target.characterId}`);
        
        const distanceToTargetParam = getDistance(npc.state.position, target.state.position);
        console.log(`[ATTACK_DEBUG] Distance to target param: ${distanceToTargetParam.toFixed(3)}`);
    } else {
        console.log(`[ATTACK_DEBUG] ERROR: Invalid target parameter:`, target);
        return;
    }

    // Get fresh client and position data
    const client = npc.server.getClientByCharId(target.characterId);
    if (!client) {
        console.log(`[ATTACK_DEBUG] ERROR: Could not find client for characterId ${target.characterId}`);
        return;
    }

    if (!client.character || !client.character.state || !client.character.state.position) {
        console.log(`[ATTACK_DEBUG] ERROR: Client character has invalid state`);
        return;
    }

    const freshPlayerPosition = client.character.state.position;
    console.log(`[ATTACK_DEBUG] Fresh player position: [${freshPlayerPosition[0].toFixed(3)}, ${freshPlayerPosition[1].toFixed(3)}, ${freshPlayerPosition[2].toFixed(3)}]`);
    
    // Calculate position differences
    const positionDrift = [
        Math.abs(target.state.position[0] - freshPlayerPosition[0]),
        Math.abs(target.state.position[1] - freshPlayerPosition[1]),
        Math.abs(target.state.position[2] - freshPlayerPosition[2])
    ];
    const totalDrift = Math.sqrt(positionDrift[0] * positionDrift[0] + positionDrift[1] * positionDrift[1] + positionDrift[2] * positionDrift[2]);
    
    console.log(`[ATTACK_DEBUG] Position drift X: ${positionDrift[0].toFixed(3)}, Y: ${positionDrift[1].toFixed(3)}, Z: ${positionDrift[2].toFixed(3)}`);
    console.log(`[ATTACK_DEBUG] Total position drift: ${totalDrift.toFixed(3)} units`);
    
    if (totalDrift > 2.0) {
        console.log(`[ATTACK_DEBUG] ⚠️ WARNING: Significant position drift detected! Target param is ${totalDrift.toFixed(3)} units behind actual player position`);
    }

    // Distance calculations
    const distanceToFreshPosition = getDistance(npc.state.position, freshPlayerPosition);
    const distanceToTargetParam = getDistance(npc.state.position, target.state.position);
    
    console.log(`[ATTACK_DEBUG] Distance to fresh position: ${distanceToFreshPosition.toFixed(3)}`);
    console.log(`[ATTACK_DEBUG] Distance to target param: ${distanceToTargetParam.toFixed(3)}`);
    console.log(`[ATTACK_DEBUG] Distance difference: ${Math.abs(distanceToFreshPosition - distanceToTargetParam).toFixed(3)}`);

    // Attack radius validation
    const attackRadius = npc.personalAttackRadius || this.plugin.ATTACK_RADIUS_MAX;
    const effectiveAttackRadius = attackRadius + 0.5; // Buffer for latency
    
    console.log(`[ATTACK_DEBUG] Personal attack radius: ${attackRadius.toFixed(3)}`);
    console.log(`[ATTACK_DEBUG] Effective attack radius (with buffer): ${effectiveAttackRadius.toFixed(3)}`);

    // Check both distances for comparison
    const canAttackTargetParam = distanceToTargetParam <= effectiveAttackRadius;
    const canAttackFreshPosition = distanceToFreshPosition <= effectiveAttackRadius;
    
    console.log(`[ATTACK_DEBUG] Can attack target param position: ${canAttackTargetParam}`);
    console.log(`[ATTACK_DEBUG] Can attack fresh position: ${canAttackFreshPosition}`);

    // Use fresh position for the actual attack decision
    if (distanceToFreshPosition > effectiveAttackRadius) {
        console.log(`[ATTACK_DEBUG] ❌ ATTACK CANCELLED: Player moved out of range since attack state was triggered`);
        console.log(`[ATTACK_DEBUG] Fresh distance (${distanceToFreshPosition.toFixed(3)}) > effective radius (${effectiveAttackRadius.toFixed(3)})`);
        
        // Log if we would have attacked using the stale position
        if (canAttackTargetParam) {
            console.log(`[ATTACK_DEBUG] 🚨 STALE POSITION WOULD HAVE CAUSED FALSE ATTACK! Target param was in range but fresh position is not.`);
        }
        
        console.log(`[ATTACK_DEBUG] ==================== Attack Cancelled ====================\n`);
        return;
    }

    // Set attack cooldown
    const randomCooldown = randomIntFromInterval(this.plugin.ATTACK_COOLDOWN_MIN_MS, this.plugin.ATTACK_COOLDOWN_MAX_MS);
    this.plugin.attackCooldowns.set(npc.characterId, now + randomCooldown);
    
    console.log(`[ATTACK_DEBUG] ✅ ATTACK PROCEEDING: Setting cooldown of ${randomCooldown}ms`);
    console.log(`[ATTACK_DEBUG] Next attack available at: ${new Date(now + randomCooldown).toISOString()}`);

    // Face the FRESH position, not the stale target
    const freshTarget = { 
        state: { 
            position: freshPlayerPosition 
        },
        characterId: target.characterId
    };
    
    this.faceTarget(npc, freshTarget);
    console.log(`[ATTACK_DEBUG] NPC facing fresh target position`);
    
    // Play attack animation
    npc.playAnimation("GrappleTell");
    console.log(`[ATTACK_DEBUG] Playing GrappleTell animation`);
    
    // FINAL VALIDATION: Check fresh position one more time right before damage
    const finalDistance = getDistance(npc.state.position, freshPlayerPosition);
    console.log(`[ATTACK_DEBUG] Final distance check: ${finalDistance.toFixed(3)}`);
    
    if (finalDistance <= effectiveAttackRadius) {
        console.log(`[ATTACK_DEBUG] 🗡️ APPLYING DAMAGE to player at fresh position`);
        
        const { MeleeTypes } = require(path.join(serverModulePath, 'out/servers/ZoneServer2016/models/enums'));
        
        // Apply damage using FRESH position data
        client.character.OnMeleeHit(npc.server, {
            entity: npc.characterId, 
            weapon: 0, 
            damage: npc.npcMeleeDamage, 
            causeBleed: false, 
            meleeType: MeleeTypes.FISTS,
            hitReport: { 
                characterId: target.characterId, 
                position: freshPlayerPosition // CRITICAL: Use fresh position, not stale target.state.position
            }
        });
        
        console.log(`[ATTACK_DEBUG] Damage applied: ${npc.npcMeleeDamage} to character ${target.characterId}`);
        console.log(`[ATTACK_DEBUG] Hit report position: [${freshPlayerPosition[0].toFixed(3)}, ${freshPlayerPosition[1].toFixed(3)}, ${freshPlayerPosition[2].toFixed(3)}]`);
        
        // Log the age of the target parameter for analysis
        if (npc.lastTargetUpdateTime) {
            const targetAge = now - npc.lastTargetUpdateTime;
            console.log(`[ATTACK_DEBUG] Target parameter age: ${targetAge}ms`);
            if (targetAge > 1000) {
                console.log(`[ATTACK_DEBUG] ⚠️ WARNING: Target parameter is ${targetAge}ms old!`);
            }
        }
        
    } else {
        console.log(`[ATTACK_DEBUG] ❌ FINAL CHECK FAILED: Player moved out of range during attack execution`);
        console.log(`[ATTACK_DEBUG] Final distance (${finalDistance.toFixed(3)}) > effective radius (${effectiveAttackRadius.toFixed(3)})`);
    }
    
    console.log(`[ATTACK_DEBUG] ==================== Attack Complete ====================\n`);
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
        this.sendMovementPacket(npc, npc.state.orientation, 0, 0);  
    }
}

    sendMovementPacket(npc, orientation, horizontalSpeed, verticalSpeed = 0) {
        npc.lastSentSpeed = horizontalSpeed;
        npc.state.orientation = orientation;
        npc.server.sendDataToAllWithSpawnedEntity(npc.server._npcs, npc.characterId, "PlayerUpdatePosition", {
            transientId: npc.transientId,
            positionUpdate: {
                sequenceTime: getCurrentServerTimeWrapper().getTruncatedU32(), 
                position: npc.state.position, unknown3_int8: 0, stance: 66565, engineRPM: 0, 
                orientation: orientation, frontTilt: 0, sideTilt: 0, angleChange: 0, 
                verticalSpeed: verticalSpeed, // Use the new parameter
                horizontalSpeed: horizontalSpeed
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