// ===================================================================================
// destroMOD Pathfinding Service - ENHANCED (Zombie Stopping Fix)
// ===================================================================================

#include <iostream>
#include <string>
#include <map>
#include <vector>
#include <fstream>
#include <sstream>
#include <thread>
#include <chrono>
#include <cmath> 
#include <cstring>
#include <regex>

// Your 64-bit Detour headers
#include "DetourNavMesh.h"
#include "DetourNavMeshQuery.h"
#include "DetourCrowd.h"

// Simple HTTP server - no external dependencies
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "ws2_32.lib")

class PathfindingService {
private:
    dtNavMesh* navMesh;
    dtNavMeshQuery* navQuery;
    dtCrowd* crowd;
    std::map<std::string, int> agentMap;
    
    static const int MAX_AGENTS = 50;
    static const int MAX_PATH_POINTS = 256;
    
public:
    PathfindingService() : navMesh(nullptr), navQuery(nullptr), crowd(nullptr) {}
    
    ~PathfindingService() {
        cleanup();
    }
    
    bool initialize(const std::string& navmeshPath) {
        std::cout << "[PathfindingService] Loading 64-bit navmesh from: " << navmeshPath << std::endl;
        
        if (!loadNavMesh(navmeshPath)) {
            std::cerr << "[PathfindingService] Failed to load navmesh" << std::endl;
            return false;
        }
        
        navQuery = dtAllocNavMeshQuery();
        if (!navQuery->init(navMesh, 2048)) {
            std::cerr << "[PathfindingService] Failed to init navmesh query" << std::endl;
            return false;
        }
        
        crowd = dtAllocCrowd();
        if (!crowd->init(MAX_AGENTS, 0.6f, navMesh)) {
            std::cerr << "[PathfindingService] Failed to init crowd" << std::endl;
            return false;
        }
        
        std::cout << "[PathfindingService] 64-bit pathfinding service ready!" << std::endl;
        return true;
    }
    
    std::vector<float> getClosestNavPoint(float x, float y, float z) {
        const float pos[3] = {x, y, z};
        const float extents[3] = {10.0f, 10.0f, 10.0f};
        dtPolyRef nearestRef;
        float nearestPt[3];
        
        dtStatus status = navQuery->findNearestPoly(pos, extents, &dtQueryFilter(), &nearestRef, nearestPt);
        if (dtStatusSucceed(status) && nearestRef) {
            return {nearestPt[0], nearestPt[1], nearestPt[2]};
        }
        return {};
    }
    
    bool hasLineOfSight(float startX, float startY, float startZ, float endX, float endY, float endZ) {
        const float start[3] = {startX, startY, startZ};
        const float end[3] = {endX, endY, endZ};
        dtPolyRef startRef;
        float startPt[3];
        float extents[3] = {20.0f, 10.0f, 20.0f};
        
        dtStatus status = navQuery->findNearestPoly(start, extents, &dtQueryFilter(), &startRef, startPt);
        if (dtStatusFailed(status) || !startRef) return true;
        
        float t;
        float hitNormal[3];
        dtPolyRef path[32];
        int pathCount = 0;
        
        status = navQuery->raycast(startRef, startPt, end, &dtQueryFilter(), &t, hitNormal, path, &pathCount, 32);
        
        return dtStatusSucceed(status) && t >= 1.0f;
    }

    bool setNPCTarget(const std::string& npcId, float targetX, float targetY, float targetZ) {
    auto it = agentMap.find(npcId);
    if (it == agentMap.end()) return false;
    
    int agentIndex = it->second;
    const dtCrowdAgent* agent = crowd->getAgent(agentIndex);
    if (!agent || !agent->active) return false;

    // CRITICAL FIX: Reset the current move target first
    crowd->resetMoveTarget(agentIndex);
    
    const float targetPos[3] = {targetX, targetY, targetZ};
    dtPolyRef targetRef;
    float nearestPt[3];
    const float extents[3] = {20.0f, 10.0f, 20.0f};
    
    dtStatus status = navQuery->findNearestPoly(targetPos, extents, &dtQueryFilter(), &targetRef, nearestPt);
    if (dtStatusSucceed(status) && targetRef) {
        return dtStatusSucceed(crowd->requestMoveTarget(agentIndex, targetRef, nearestPt));
    }
    return false;
}
    
    // ENHANCED: Original stopNPC with immediate velocity zeroing
    bool stopNPC(const std::string& npcId) {
        auto it = agentMap.find(npcId);
        if (it == agentMap.end()) return false;
        
        int agentIndex = it->second;
        const dtCrowdAgent* agent = crowd->getAgent(agentIndex);
        if (!agent || !agent->active) return false;
        
        // Reset move target
        dtStatus result = crowd->resetMoveTarget(agentIndex);
        
        // NEW: Immediately zero velocity
        if (crowd->getEditableAgent(agentIndex)) {
            dtCrowdAgent* editableAgent = crowd->getEditableAgent(agentIndex);
            editableAgent->vel[0] = 0.0f;
            editableAgent->vel[1] = 0.0f;
            editableAgent->vel[2] = 0.0f;
            editableAgent->dvel[0] = 0.0f;
            editableAgent->dvel[1] = 0.0f;
            editableAgent->dvel[2] = 0.0f;
        }
        
        return dtStatusSucceed(result);
    }

    // NEW: Force stop with immediate velocity zeroing and brake force
    bool forceStopNPC(const std::string& npcId, float brakeForce = 10.0f) {
        auto it = agentMap.find(npcId);
        if (it == agentMap.end()) return false;
        
        int agentIndex = it->second;
        const dtCrowdAgent* agent = crowd->getAgent(agentIndex);
        if (!agent || !agent->active) return false;
        
        // Reset move target
        crowd->resetMoveTarget(agentIndex);
        
        // Apply brake force to immediately zero velocity
        if (crowd->getEditableAgent(agentIndex)) {
            dtCrowdAgent* editableAgent = crowd->getEditableAgent(agentIndex);
            
            // Zero out velocity immediately
            editableAgent->vel[0] = 0.0f;
            editableAgent->vel[1] = 0.0f;
            editableAgent->vel[2] = 0.0f;
            
            // Zero out desired velocity
            editableAgent->dvel[0] = 0.0f;
            editableAgent->dvel[1] = 0.0f;
            editableAgent->dvel[2] = 0.0f;
            
            // Apply strong deceleration parameters
            dtCrowdAgentParams params = editableAgent->params;
            params.maxAcceleration = brakeForce * 100.0f; // High deceleration
            crowd->updateAgentParameters(agentIndex, &params);
            
            std::cout << "[PathfindingService] Force stopped NPC " << npcId 
                      << " with brake force " << brakeForce << std::endl;
        }
        
        return true;
    }

    // NEW: Check if agent is at target destination
    bool isAgentAtTarget(const std::string& npcId, float threshold = 2.0f) {
        auto it = agentMap.find(npcId);
        if (it == agentMap.end()) return false;
        
        int agentIndex = it->second;
        const dtCrowdAgent* agent = crowd->getAgent(agentIndex);
        if (!agent || !agent->active) return false;
        
        // Check if agent has reached its target
        if (agent->targetState == DT_CROWDAGENT_TARGET_VALID) {
            float dx = agent->npos[0] - agent->targetPos[0];
            float dz = agent->npos[2] - agent->targetPos[2];
            float distance = sqrtf(dx * dx + dz * dz);
            
            return distance <= threshold;
        }
        
        return false;
    }
    
    // ENHANCED: addAggroedNPC with better collision avoidance parameters
    bool addAggroedNPC(const std::string& npcId, float x, float y, float z) {
        auto navPoint = getClosestNavPoint(x, y, z);
        if (navPoint.empty()) return false;
        
        dtCrowdAgentParams params;
        memset(&params, 0, sizeof(params));

        // Enhanced parameters for better collision detection and stopping
        params.radius = 0.3f; // Slightly larger radius for better collision
        params.height = 1.0f;
        params.maxAcceleration = 80.0f;
        params.maxSpeed = 8.5f;
        params.collisionQueryRange = params.radius * 10.0f; // Increased collision range
        params.pathOptimizationRange = params.radius * 20.0f;
        params.separationWeight = 10.0f; // Increased separation from other agents
        
        // Enhanced obstacle avoidance for better player collision
        params.obstacleAvoidanceType = 3; // High quality obstacle avoidance
        
        params.updateFlags = DT_CROWD_ANTICIPATE_TURNS | 
                            DT_CROWD_OPTIMIZE_VIS | 
                            DT_CROWD_OPTIMIZE_TOPO | 
                            DT_CROWD_SEPARATION |
                            DT_CROWD_OBSTACLE_AVOIDANCE; // Enable obstacle avoidance

        float pos[3] = {navPoint[0], navPoint[1], navPoint[2]};
        int agentIndex = crowd->addAgent(pos, &params);
        
        if (agentIndex < 0) return false;
        
        agentMap[npcId] = agentIndex;
        return true;
    }
    
    bool removeAggroedNPC(const std::string& npcId) {
        auto it = agentMap.find(npcId);
        if (it == agentMap.end()) return false;
        
        crowd->removeAgent(it->second);
        agentMap.erase(it);
        return true;
    }
    
    std::vector<float> getAgentPosition(const std::string& npcId) {
        auto it = agentMap.find(npcId);
        if (it == agentMap.end()) return {};
        const dtCrowdAgent* agent = crowd->getAgent(it->second);
        if (!agent) return {};
        return {agent->npos[0], agent->npos[1], agent->npos[2]};
    }
    
    std::vector<float> getAgentVelocity(const std::string& npcId) {
        auto it = agentMap.find(npcId);
        if (it == agentMap.end()) return {};
        const dtCrowdAgent* agent = crowd->getAgent(it->second);
        if (!agent) return {};
        return {agent->vel[0], agent->vel[1], agent->vel[2]};
    }
    
    void update(float deltaTime = 0.025f) {
    if (crowd) {
        crowd->update(deltaTime, nullptr);
    }
}
    
    std::vector<std::vector<float>> testNavMesh(float startX, float startY, float startZ, float endX, float endY, float endZ) {
        const float start[3] = {startX, startY, startZ};
        const float end[3] = {endX, endY, endZ};
        const float extents[3] = {10.0f, 10.0f, 10.0f};
        dtPolyRef startRef, endRef;
        float startPt[3], endPt[3];
        
        navQuery->findNearestPoly(start, extents, &dtQueryFilter(), &startRef, startPt);
        navQuery->findNearestPoly(end, extents, &dtQueryFilter(), &endRef, endPt);
        
        if (!startRef || !endRef) return {};
        
        dtPolyRef path[MAX_PATH_POINTS];
        int pathCount = 0;
        navQuery->findPath(startRef, endRef, startPt, endPt, &dtQueryFilter(), path, &pathCount, MAX_PATH_POINTS);
        
        if (pathCount == 0) return {};
        
        float straightPath[MAX_PATH_POINTS * 3];
        int straightPathCount = 0;
        navQuery->findStraightPath(startPt, endPt, path, pathCount, straightPath, nullptr, nullptr, &straightPathCount, MAX_PATH_POINTS);
        
        if (straightPathCount > 0) {
            std::vector<std::vector<float>> result;
            for (int i = 0; i < straightPathCount; i++) {
                result.push_back({straightPath[i*3], straightPath[i*3+1], straightPath[i*3+2]});
            }
            return result;
        }
        return {};
    }

private:
    bool loadNavMesh(const std::string& filepath) {
        std::ifstream file(filepath, std::ios::binary);
        if (!file) {
            std::cout << "[ERROR] Could not open file: " << filepath << std::endl;
            return false;
        }
        
        file.seekg(0, std::ios::end);
        size_t fileSize = file.tellg();
        file.seekg(0, std::ios::beg);
        
        unsigned char* data = new unsigned char[fileSize];
        file.read(reinterpret_cast<char*>(data), fileSize);
        file.close();
        
        const unsigned char* d = data;
        if (*reinterpret_cast<const int*>(d) != 0x4D534554) {
            std::cout << "[ERROR] Not a TESM format file" << std::endl;
            delete[] data;
            return false;
        }
        d += sizeof(int) * 3;
        
        dtNavMeshParams params;
        memcpy(&params, d, sizeof(dtNavMeshParams));
        d += sizeof(dtNavMeshParams);
        
        navMesh = dtAllocNavMesh();
        if (!navMesh || dtStatusFailed(navMesh->init(&params))) {
            delete[] data;
            if(navMesh) dtFreeNavMesh(navMesh);
            navMesh = nullptr;
            return false;
        }
        
        int tilesLoaded = 0;
        const unsigned char* end = data + fileSize;
        while (d < end - 8) {
            if (*reinterpret_cast<const int*>(d) == 0x444E4156) {
                const unsigned char* tileStart = d;
                const unsigned char* nextTile = d + 8;
                while (nextTile < end - 4 && *reinterpret_cast<const int*>(nextTile) != 0x444E4156) nextTile++;
                size_t tileSize = (nextTile >= end - 4) ? (end - tileStart) : (nextTile - tileStart);
                unsigned char* tileData = (unsigned char*)dtAlloc(tileSize, DT_ALLOC_PERM);
                memcpy(tileData, tileStart, tileSize);
                if (dtStatusSucceed(navMesh->addTile(tileData, (int)tileSize, DT_TILE_FREE_DATA, 0, nullptr))) {
                tilesLoaded++;
                } else {
                dtFree(tileData);  // Use dtFree instead of delete[]
}
                d = nextTile;
            } else {
                d++;
            }
        }
        
        delete[] data;
        std::cout << "[DEBUG] Loaded " << tilesLoaded << " tiles successfully" << std::endl;
        return tilesLoaded > 0;
    }
    
    void cleanup() {
        if (crowd) dtFreeCrowd(crowd);
        if (navQuery) dtFreeNavMeshQuery(navQuery);
        if (navMesh) dtFreeNavMesh(navMesh);
        crowd = nullptr;
        navQuery = nullptr;
        navMesh = nullptr;
    }
};

std::string makeHttpResponse(const std::string& content, const std::string& contentType = "application/json") {
    std::ostringstream response;
    response << "HTTP/1.1 200 OK\r\n";
    response << "Content-Type: " << contentType << "\r\n";
    response << "Content-Length: " << content.length() << "\r\n";
    response << "Access-Control-Allow-Origin: *\r\n";
    response << "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n";
    response << "Access-Control-Allow-Headers: Content-Type\r\n";
    response << "\r\n" << content;
    return response.str();
}

std::string extractString(const std::string& json, const std::string& key) {
    std::regex pattern("\"" + key + "\"\\s*:\\s*\"([^\"]+)\"");
    std::smatch match;
    return std::regex_search(json, match, pattern) ? match[1].str() : "";
}

float extractFloat(const std::string& json, const std::string& key) {
    std::regex pattern("\"" + key + "\"\\s*:\\s*(-?\\d*\\.?\\d+)");
    std::smatch match;
    return std::regex_search(json, match, pattern) ? std::stof(match[1].str()) : 0.0f;
}

std::vector<float> extractArray(const std::string& json, const std::string& key) {
    std::vector<float> result;
    std::regex pattern("\"" + key + "\"\\s*:\\s*\\[([^\\]]+)\\]");
    std::smatch match;
    if (std::regex_search(json, match, pattern)) {
        std::string content = match[1].str();
        std::regex floatPattern("(-?\\d*\\.?\\d+)");
        auto it = std::sregex_iterator(content.begin(), content.end(), floatPattern);
        for (; it != std::sregex_iterator(); ++it) {
            result.push_back(std::stof((*it)[1].str()));
        }
    }
    return result;
}

std::string handleHttpRequest(const std::string& method, const std::string& path, const std::string& body, PathfindingService& service) {
    if (method == "POST") {
        if (path == "/getClosestNavPoint") {
            auto result = service.getClosestNavPoint(extractFloat(body, "x"), extractFloat(body, "y"), extractFloat(body, "z"));
            std::ostringstream json;
            json << "{\"success\": " << (result.empty() ? "false" : "true") << ", \"point\": " << (result.empty() ? "null" : "{\"x\":" + std::to_string(result[0]) + ",\"y\":" + std::to_string(result[1]) + ",\"z\":" + std::to_string(result[2]) + "}") << "}";
            return makeHttpResponse(json.str());
        }
        if (path == "/hasLineOfSight") {
            auto start = extractArray(body, "start"), end = extractArray(body, "end");
            if (start.size() >= 3 && end.size() >= 3) {
                bool hasLOS = service.hasLineOfSight(start[0], start[1], start[2], end[0], end[1], end[2]);
                return makeHttpResponse("{\"success\": true, \"hasLineOfSight\": " + std::string(hasLOS ? "true" : "false") + "}");
            }
        }
        if (path == "/setNPCTarget") {
            auto target = extractArray(body, "target");
            if (!extractString(body, "npcId").empty() && target.size() >= 3) {
                bool success = service.setNPCTarget(extractString(body, "npcId"), target[0], target[1], target[2]);
                return makeHttpResponse("{\"success\": " + std::string(success ? "true" : "false") + "}");
            }
        }
        if (path == "/addAggroedNPC") {
            if (!extractString(body, "npcId").empty()) {
                bool success = service.addAggroedNPC(extractString(body, "npcId"), extractFloat(body, "x"), extractFloat(body, "y"), extractFloat(body, "z"));
                return makeHttpResponse("{\"success\": " + std::string(success ? "true" : "false") + "}");
            }
        }
        if (path == "/removeAggroedNPC") {
            if (!extractString(body, "npcId").empty()) {
                bool success = service.removeAggroedNPC(extractString(body, "npcId"));
                return makeHttpResponse("{\"success\": " + std::string(success ? "true" : "false") + "}");
            }
        }
        if (path == "/stopNPC") {
            std::string npcId = extractString(body, "npcId");
            if (!npcId.empty()) {
                bool success = service.stopNPC(npcId);
                return makeHttpResponse("{\"success\": " + std::string(success ? "true" : "false") + "}");
            }
        }
        // NEW: Force stop endpoint
        if (path == "/forceStopNPC") {
            std::string npcId = extractString(body, "npcId");
            float brakeForce = extractFloat(body, "brakeForce");
            if (brakeForce == 0.0f) brakeForce = 10.0f; // Default brake force
            
            if (!npcId.empty()) {
                bool success = service.forceStopNPC(npcId, brakeForce);
                return makeHttpResponse("{\"success\": " + std::string(success ? "true" : "false") + "}");
            }
        }
        // NEW: Target reached check endpoint
        if (path == "/isAgentAtTarget") {
            std::string npcId = extractString(body, "npcId");
            if (!npcId.empty()) {
                bool atTarget = service.isAgentAtTarget(npcId);
                return makeHttpResponse("{\"success\": true, \"atTarget\": " + std::string(atTarget ? "true" : "false") + "}");
            }
        }
        if (path == "/getAgentPosition") {
            auto pos = service.getAgentPosition(extractString(body, "npcId"));
            std::ostringstream json;
            json << "{\"success\": " << (pos.empty() ? "false" : "true") << ", \"position\": " << (pos.empty() ? "null" : "[" + std::to_string(pos[0]) + "," + std::to_string(pos[1]) + "," + std::to_string(pos[2]) + "]") << "}";
            return makeHttpResponse(json.str());
        }
        if (path == "/getAgentVelocity") {
            auto vel = service.getAgentVelocity(extractString(body, "npcId"));
            std::ostringstream json;
            json << "{\"success\": " << (vel.empty() ? "false" : "true") << ", \"velocity\": " << (vel.empty() ? "null" : "[" + std::to_string(vel[0]) + "," + std::to_string(vel[1]) + "," + std::to_string(vel[2]) + "]") << "}";
            return makeHttpResponse(json.str());
        }
        if (path == "/testNavMesh") {
            auto start = extractArray(body, "start"), end = extractArray(body, "end");
            if (start.size() >= 3 && end.size() >= 3) {
                auto path = service.testNavMesh(start[0], start[1], start[2], end[0], end[1], end[2]);
                std::ostringstream json;
                json << "{\"success\": true, \"path\": [";
                for (size_t i = 0; i < path.size(); i++) {
                    if (i > 0) json << ", ";
                    json << "[" << path[i][0] << ", " << path[i][1] << ", " << path[i][2] << "]";
                }
                json << "]}";
                return makeHttpResponse(json.str());
            }
        }
    }
    if (method == "GET" && path == "/health") {
        return makeHttpResponse("{\"status\": \"ok\", \"service\": \"64-bit pathfinding enhanced\"}");
    }
    if (method == "OPTIONS") {
        return makeHttpResponse("", "text/plain");
    }
    return makeHttpResponse("{\"success\": false, \"error\": \"Unknown endpoint\"}", "application/json");
}

void runHttpServer(PathfindingService& service, int port = 8080) {
    WSADATA wsaData;
    WSAStartup(MAKEWORD(2, 2), &wsaData);
    
    SOCKET serverSocket = socket(AF_INET, SOCK_STREAM, 0);
    char opt = 1;
    setsockopt(serverSocket, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
    
    sockaddr_in serverAddr;
    serverAddr.sin_family = AF_INET;
    serverAddr.sin_addr.s_addr = INADDR_ANY;
    serverAddr.sin_port = htons(port);
    
    bind(serverSocket, (sockaddr*)&serverAddr, sizeof(serverAddr));
    listen(serverSocket, 5);
    
    std::cout << "[HttpServer] Enhanced 64-bit pathfinding service listening on port " << port << std::endl;
    
    while (true) {
        SOCKET clientSocket = accept(serverSocket, nullptr, nullptr);
        if (clientSocket == INVALID_SOCKET) continue;
        
        std::thread([clientSocket, &service]() {
            char buffer[8192];
            int received = recv(clientSocket, buffer, sizeof(buffer) - 1, 0);
            if (received > 0) {
                buffer[received] = '\0';
                std::string request(buffer);
                std::istringstream rs(request);
                std::string method, path;
                rs >> method >> path;
                size_t bodyPos = request.find("\r\n\r\n");
                std::string body = (bodyPos != std::string::npos) ? request.substr(bodyPos + 4) : "";
                std::string response = handleHttpRequest(method, path, body, service);
                send(clientSocket, response.c_str(), (int)response.length(), 0);
            }
            closesocket(clientSocket);
        }).detach();
    }
    
    closesocket(serverSocket);
    WSACleanup();
}

int main() {
    PathfindingService service;
    if (!service.initialize("all_tiles_navmesh_v10_64bit.bin")) {
        std::cerr << "Failed to initialize enhanced pathfinding service. Make sure the navmesh file is present." << std::endl;
        std::cout << "Press Enter to exit..." << std::endl;
        std::cin.get();
        return 1;
    }
    
    std::thread updateThread([&service]() {
        while (true) {
            service.update(0.025f);
            std::this_thread::sleep_for(std::chrono::milliseconds(33));
        }
    });
    
    runHttpServer(service, 8080);
    
    updateThread.join();
    return 0;
}