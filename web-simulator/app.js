/**
 * Goa Distributed ACS Simulator - Core Logic
 * Authors: Antigravity AI Coding Assistant & Student
 */

// --- 1. Global Configurations & State ---
const canvas = document.getElementById('sim-canvas');
const ctx = canvas.getContext('2d');

let isRunning = false;
let currentMode = 'mono'; // 'mono' (Monolithic) or 'dist' (Goa Distributed)
let simulationSpeed = 2;
let orderSpawnRate = 5; // 1 to 10
let animationFrameId = null;

// Metrics
let stats = {
    mono: { throughput: 0, totalTime: 0, activeTime: 0, deadlocks: 0, cpuSamples: [] },
    dist: { throughput: 0, totalTime: 0, activeTime: 0, deadlocks: 0, cpuSamples: [] }
};
let activeStats = { throughput: 0, avgLeadTime: 0.0, deadlocks: 0, cpu: 0 };
let simulationTime = 0;
let ordersList = [];
let logs = [];

// Warehouse Layout coordinates (Grid cells: 20x12 grid)
const gridCols = 20;
const gridRows = 12;
const cellWidth = canvas.width / gridCols;
const cellHeight = canvas.height / gridRows;

// Warehouse map entities
const MapEntities = {
    racks: [],
    aisle1X: 4,  // Column index for Aisle 1
    aisle2X: 12, // Column index for Aisle 2
    interceptorCorridorY: 9, // Row index for high-speed corridor
    buffer1: { x: 4, y: 9, isOccupied: false, item: null },
    buffer2: { x: 12, y: 9, isOccupied: false, item: null },
    shippingDock: { x: 18, y: 9 } // Shipping dock destination
};

// Initialize racks
for (let c = 0; c < gridCols; c++) {
    for (let r = 0; r < gridRows; r++) {
        // Build racks around aisles
        if ((c === 2 || c === 3 || c === 5 || c === 6) && r >= 2 && r <= 7) {
            MapEntities.racks.push({ x: c, y: r, aisle: 1 });
        }
        if ((c === 10 || c === 11 || c === 13 || c === 14) && r >= 2 && r <= 7) {
            MapEntities.racks.push({ x: c, y: r, aisle: 2 });
        }
    }
}

// Robots Arrays
let amrs = [];

// --- 2. Robot Class Definition (Agent) ---
class AMR {
    constructor(id, type, startX, startY, color, constrainedAisle = null) {
        this.id = id;
        this.type = type; // 'aisle', 'interceptor', 'mono'
        this.x = startX;
        this.y = startY;
        this.color = color;
        this.constrainedAisle = constrainedAisle; // 1, 2, or null
        
        // Navigation states
        this.targetX = startX;
        this.targetY = startY;
        this.status = 'IDLE'; // IDLE, MOVING, PICKING, LOADED, RETURNING
        this.path = [];
        this.currentItem = null;
        this.progress = 0; // Movement interpolation (0 to 1)
        this.delayTicks = 0; // Simulated deadlock / collision delay
    }

    update() {
        if (this.delayTicks > 0) {
            this.delayTicks--;
            this.status = 'DELAYED';
            return;
        }

        if (this.status === 'DELAYED') {
            this.status = 'MOVING';
        }

        // If at destination coordinate, check for next node in path
        if (this.x === this.targetX && this.y === this.targetY) {
            if (this.path.length > 0) {
                const nextNode = this.path.shift();
                
                // Collision Detection logic (Only severe in Monolithic Mode)
                if (currentMode === 'mono') {
                    const isOccupied = amrs.some(other => 
                        other.id !== this.id && 
                        (other.targetX === nextNode.x && other.targetY === nextNode.y)
                    );
                    if (isOccupied && Math.random() < 0.25) { // 25% chance of bottleneck deadlock
                        this.delayTicks = 30 + Math.floor(Math.random() * 40); // 30-70 ticks delay
                        activeStats.deadlocks++;
                        stats.mono.deadlocks++;
                        addLog(`[Mono-ACS] Alert: Traffic deadlock at grid (${nextNode.x}, ${nextNode.y}) for ${this.id}. Recalculating path.`, 'alert');
                        return;
                    }
                }

                this.targetX = nextNode.x;
                this.targetY = nextNode.y;
                this.progress = 0;
                this.status = 'MOVING';
            } else {
                // Completed current path
                this.onReachedDestination();
            }
        }

        // Interpolation movement
        if (this.x !== this.targetX || this.y !== this.targetY) {
            const step = 0.05 * simulationSpeed;
            this.progress += step;
            if (this.progress >= 1) {
                this.x = this.targetX;
                this.y = this.targetY;
                this.progress = 0;
            }
        }
    }

    onReachedDestination() {
        if (this.status === 'MOVING') {
            if (this.currentItem) {
                if (currentMode === 'mono') {
                    if (this.x === this.currentItem.rack.x && this.y === this.currentItem.rack.y && !this.currentItem.isPicked) {
                        // Picked up item
                        this.status = 'PICKING';
                        this.delayTicks = 20; // picking duration
                        this.currentItem.isPicked = true;
                        addLog(`[Mono-ACS] ${this.id} reached rack (${this.x}, ${this.y}). Picking Item ${this.currentItem.id}.`, 'mono');
                    } else if (this.x === MapEntities.shippingDock.x && this.y === MapEntities.shippingDock.y) {
                        // Deliver complete in monolithic mode
                        this.status = 'IDLE';
                        completeOrder(this.currentItem);
                        this.currentItem = null;
                    } else {
                        // Moving to Shipping Dock
                        this.setPathTo(MapEntities.shippingDock.x, MapEntities.shippingDock.y);
                    }
                } else {
                    // Goa Distributed Mode logic
                    if (this.type === 'aisle') {
                        // 1. Picking at rack
                        if (this.x === this.currentItem.rack.x && this.y === this.currentItem.rack.y && !this.currentItem.isPicked) {
                            this.status = 'PICKING';
                            this.delayTicks = 20;
                            this.currentItem.isPicked = true;
                            addLog(`[Goa-ACS Aisle-${this.constrainedAisle}] ${this.id} picking Item ${this.currentItem.id} from Rack.`, 'dist');
                        } 
                        // 2. Put down at Rendezvous Buffer
                        else if (this.x === (this.constrainedAisle === 1 ? MapEntities.buffer1.x : MapEntities.buffer2.x) && 
                                 this.y === (this.constrainedAisle === 1 ? MapEntities.buffer1.y : MapEntities.buffer2.y)) {
                            const buffer = this.constrainedAisle === 1 ? MapEntities.buffer1 : MapEntities.buffer2;
                            
                            if (!buffer.isOccupied) {
                                buffer.isOccupied = true;
                                buffer.item = this.currentItem;
                                this.currentItem.isAtBuffer = true;
                                addLog(`[Goa-ACS Aisle-${this.constrainedAisle}] POST /aisle/${this.constrainedAisle}/buffer - Loaded Item ${this.currentItem.id} to buffer.`, 'success');
                                
                                // Call Goa Interceptor service API to request collection
                                triggerGoaInterceptRequest(this.constrainedAisle, this.currentItem);
                                
                                this.currentItem = null;
                                this.status = 'IDLE';
                            } else {
                                // Buffer full, wait (Simulate Local Buffer Block)
                                this.delayTicks = 10;
                                this.status = 'DELAYED';
                            }
                        }
                        // 3. Move to Buffer
                        else {
                            const buffer = this.constrainedAisle === 1 ? MapEntities.buffer1 : MapEntities.buffer2;
                            this.setPathTo(buffer.x, buffer.y);
                        }
                    } else if (this.type === 'interceptor') {
                        // Interceptor actions
                        const currentTargetOrder = this.currentItem;
                        
                        // 1. Reached Buffer to Pick
                        if (this.x === currentTargetOrder.bufferX && this.y === currentTargetOrder.bufferY && !currentTargetOrder.isPickedByInterceptor) {
                            const buffer = currentTargetOrder.aisle === 1 ? MapEntities.buffer1 : MapEntities.buffer2;
                            if (buffer.isOccupied && buffer.item && buffer.item.id === currentTargetOrder.id) {
                                buffer.isOccupied = false;
                                buffer.item = null;
                                currentTargetOrder.isPickedByInterceptor = true;
                                this.status = 'PICKING';
                                this.delayTicks = 15;
                                addLog(`[Goa-ACS Interceptor] Interceptor retrieval completed for Item ${currentTargetOrder.id}. Moving to Shipping Dock.`, 'dist');
                            } else {
                                // Rendezvous discrepancy (Wait)
                                this.delayTicks = 5;
                            }
                        }
                        // 2. Reached Shipping Dock to Deliver
                        else if (this.x === MapEntities.shippingDock.x && this.y === MapEntities.shippingDock.y) {
                            this.status = 'IDLE';
                            completeOrder(currentTargetOrder);
                            this.currentItem = null;
                        }
                        // 3. Set path to delivery
                        else if (currentTargetOrder.isPickedByInterceptor) {
                            this.setPathTo(MapEntities.shippingDock.x, MapEntities.shippingDock.y);
                        }
                    }
                }
            } else {
                this.status = 'IDLE';
            }
        } else if (this.status === 'PICKING') {
            this.status = 'LOADED';
            if (currentMode === 'mono') {
                this.setPathTo(MapEntities.shippingDock.x, MapEntities.shippingDock.y);
            } else {
                if (this.type === 'aisle') {
                    const buffer = this.constrainedAisle === 1 ? MapEntities.buffer1 : MapEntities.buffer2;
                    this.setPathTo(buffer.x, buffer.y);
                } else if (this.type === 'interceptor') {
                    this.setPathTo(MapEntities.shippingDock.x, MapEntities.shippingDock.y);
                }
            }
        }
    }

    setPathTo(tx, ty) {
        // Pathfinding (Modified A* / Grid Manhattan Distance Path)
        this.path = calculatePath(this.x, this.y, tx, ty, this.constrainedAisle);
    }

    draw() {
        // Smooth interpolation coordinate
        const drawX = this.x * cellWidth + (this.targetX - this.x) * cellWidth * this.progress;
        const drawY = this.y * cellHeight + (this.targetY - this.y) * cellHeight * this.progress;

        // Draw Robot Circle
        ctx.beginPath();
        ctx.arc(drawX + cellWidth / 2, drawY + cellHeight / 2, cellWidth / 2.5, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0; // reset

        // Draw Carrying Item Indicator
        if (this.status === 'LOADED') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(drawX + cellWidth / 3, drawY + cellHeight / 3, cellWidth / 3, cellHeight / 3);
            ctx.strokeStyle = '#000000';
            ctx.strokeRect(drawX + cellWidth / 3, drawY + cellHeight / 3, cellWidth / 3, cellHeight / 3);
        }

        // Draw label
        ctx.fillStyle = '#ffffff';
        ctx.font = '8px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.id, drawX + cellWidth / 2, drawY + cellHeight / 2 - cellHeight / 2.2);
    }
}

// --- 3. Pathfinding Algorithm ---
function calculatePath(sx, sy, tx, ty, aisleConstrain = null) {
    const path = [];
    let cx = sx;
    let cy = sy;

    // Direct routing algorithm respecting constraints
    while (cx !== tx || cy !== ty) {
        // If constrained to Aisle 1
        if (aisleConstrain === 1) {
            // Keep inside Aisle 1 column structure
            if (cy < ty) cy++;
            else if (cy > ty) cy--;
            else if (cx < tx) cx++;
            else if (cx > tx) cx--;
        }
        // If constrained to Aisle 2
        else if (aisleConstrain === 2) {
            if (cy < ty) cy++;
            else if (cy > ty) cy--;
            else if (cx < tx) cx++;
            else if (cx > tx) cx--;
        }
        // If Interceptor robot
        else if (aisleConstrain === 'interceptor') {
            // Move horizontally through interceptor corridor
            if (cy !== MapEntities.interceptorCorridorY) {
                if (cy < MapEntities.interceptorCorridorY) cy++;
                else cy--;
            } else {
                if (cx < tx) cx++;
                else if (cx > tx) cx--;
            }
        }
        // Monolithic: Unrestricted path grid
        else {
            if (cx !== tx) {
                if (cx < tx) cx++;
                else cx--;
            } else if (cy !== ty) {
                if (cy < ty) cy++;
                else cy--;
            }
        }
        path.push({ x: cx, y: cy });
    }
    return path;
}

// --- 4. Goa HTTP/gRPC Simulation Handler ---
function triggerGoaInterceptRequest(aisleId, item) {
    addLog(`[Goa-API] POST /interceptor/request - Source Aisle: ${aisleId}, Target: Dock, Item: ${item.id}`, 'dist');
    
    // Find interceptor robot and assign task
    const interceptor = amrs.find(r => r.type === 'interceptor');
    if (interceptor && interceptor.status === 'IDLE') {
        item.bufferX = aisleId === 1 ? MapEntities.buffer1.x : MapEntities.buffer2.x;
        item.bufferY = aisleId === 1 ? MapEntities.buffer1.y : MapEntities.buffer2.y;
        
        interceptor.currentItem = item;
        interceptor.status = 'MOVING';
        interceptor.setPathTo(item.bufferX, item.bufferY);
        addLog(`[Goa-ACS] Interceptor assigned to retrieve Item ${item.id} from Aisle-${aisleId} Buffer.`, 'success');
    }
}

// --- 5. Order Management ---
function createOrder() {
    const isAisle1 = Math.random() < 0.5;
    const aisleRacks = MapEntities.racks.filter(r => r.aisle === (isAisle1 ? 1 : 2));
    const randomRack = aisleRacks[Math.floor(Math.random() * aisleRacks.length)];
    
    const order = {
        id: 'ORD-' + (Math.floor(Math.random() * 900) + 100),
        rack: randomRack,
        aisle: isAisle1 ? 1 : 2,
        isPicked: false,
        isAtBuffer: false,
        isPickedByInterceptor: false,
        startTime: Date.now(),
        completionTime: null
    };

    ordersList.push(order);
    
    // Assign order to robot
    if (currentMode === 'mono') {
        // In mono mode, assign to any idle robot
        const idleAMR = amrs.find(r => r.status === 'IDLE');
        if (idleAMR) {
            idleAMR.currentItem = order;
            idleAMR.status = 'MOVING';
            idleAMR.setPathTo(order.rack.x, order.rack.y);
            addLog(`[Mono-ACS] Global assign order ${order.id} to robot ${idleAMR.id}`, 'mono');
        }
    } else {
        // In distributed mode, assign to specific aisle robot
        const idleAisleAMR = amrs.find(r => r.type === 'aisle' && r.constrainedAisle === order.aisle && r.status === 'IDLE');
        if (idleAisleAMR) {
            idleAisleAMR.currentItem = order;
            idleAisleAMR.status = 'MOVING';
            idleAisleAMR.setPathTo(order.rack.x, order.rack.y);
            addLog(`[Goa-ACS Aisle-${order.aisle}] Assigned order ${order.id} to local AMR ${idleAisleAMR.id}`, 'dist');
        }
    }
}

function completeOrder(order) {
    order.completionTime = Date.now();
    const duration = (order.completionTime - order.startTime) / 1000; // seconds
    
    if (currentMode === 'mono') {
        stats.mono.throughput++;
        stats.mono.totalTime += duration;
    } else {
        stats.dist.throughput++;
        stats.dist.totalTime += duration;
    }

    activeStats.throughput++;
    const currentTotalTime = currentMode === 'mono' ? stats.mono.totalTime : stats.dist.totalTime;
    const currentThroughput = currentMode === 'mono' ? stats.mono.throughput : stats.dist.throughput;
    activeStats.avgLeadTime = (currentTotalTime / currentThroughput).toFixed(1);
    
    updateDashboardMetrics();
    addLog(`[System] Success: Delivered ${order.id}. Delivery time: ${duration.toFixed(1)}s.`, 'success');
}

// --- 6. Visualizer Rendering (Canvas) ---
function drawWarehouse() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Grid Lines (Subtle)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= gridCols; c++) {
        ctx.beginPath();
        ctx.moveTo(c * cellWidth, 0);
        ctx.lineTo(c * cellWidth, canvas.height);
        ctx.stroke();
    }
    for (let r = 0; r <= gridRows; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * cellHeight);
        ctx.lineTo(canvas.width, r * cellHeight);
        ctx.stroke();
    }

    // Draw Aisle paths (Subtle highlighted path background)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.fillRect(MapEntities.aisle1X * cellWidth, 0, cellWidth, cellHeight * 10);
    ctx.fillRect(MapEntities.aisle2X * cellWidth, 0, cellWidth, cellHeight * 10);
    
    // Draw Interceptor High-speed corridor
    ctx.fillStyle = 'rgba(255, 208, 0, 0.04)';
    ctx.fillRect(0, MapEntities.interceptorCorridorY * cellHeight, canvas.width, cellHeight);

    // Draw Racks
    MapEntities.racks.forEach(rack => {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.fillRect(rack.x * cellWidth + 2, rack.y * cellHeight + 2, cellWidth - 4, cellHeight - 4);
        ctx.strokeRect(rack.x * cellWidth + 2, rack.y * cellHeight + 2, cellWidth - 4, cellHeight - 4);
    });

    // Draw Rendezvous Buffer Zones
    [MapEntities.buffer1, MapEntities.buffer2].forEach((buf, idx) => {
        ctx.fillStyle = buf.isOccupied ? 'rgba(255, 0, 127, 0.25)' : 'rgba(255, 0, 127, 0.08)';
        ctx.strokeStyle = 'var(--neon-magenta)';
        ctx.lineWidth = 2;
        ctx.fillRect(buf.x * cellWidth + 1, buf.y * cellHeight + 1, cellWidth - 2, cellHeight - 2);
        ctx.strokeRect(buf.x * cellWidth + 1, buf.y * cellHeight + 1, cellWidth - 2, cellHeight - 2);

        // Label
        ctx.fillStyle = '#ffffff';
        ctx.font = '10px Outfit';
        ctx.textAlign = 'center';
        ctx.fillText(`R-BUF-${idx+1}`, buf.x * cellWidth + cellWidth / 2, buf.y * cellHeight + cellHeight / 1.4);

        // Draw physical box if occupied
        if (buf.isOccupied) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(buf.x * cellWidth + cellWidth / 4, buf.y * cellHeight + cellHeight / 4, cellWidth / 2, cellHeight / 2);
            ctx.strokeStyle = '#000000';
            ctx.strokeRect(buf.x * cellWidth + cellWidth / 4, buf.y * cellHeight + cellHeight / 4, cellWidth / 2, cellHeight / 2);
        }
    });

    // Draw Shipping Dock Target
    ctx.fillStyle = 'rgba(168, 85, 247, 0.2)';
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 2;
    ctx.fillRect(MapEntities.shippingDock.x * cellWidth + 1, MapEntities.shippingDock.y * cellHeight + 1, cellWidth * 2 - 2, cellHeight - 2);
    ctx.strokeRect(MapEntities.shippingDock.x * cellWidth + 1, MapEntities.shippingDock.y * cellHeight + 1, cellWidth * 2 - 2, cellHeight - 2);

    ctx.fillStyle = '#ffffff';
    ctx.font = '10px Outfit';
    ctx.textAlign = 'center';
    ctx.fillText('SHIPPING DOCK', MapEntities.shippingDock.x * cellWidth + cellWidth, MapEntities.shippingDock.y * cellHeight + cellHeight / 1.4);

    // Draw Robots
    amrs.forEach(amr => amr.draw());
}

// --- 7. CPU Load & Simulation Performance Engine ---
function simulateCPULoad() {
    let cpu = 0;
    if (currentMode === 'mono') {
        // High load: Monolithic ACS computes global paths for multiple robots in complex mesh
        // FMS Bottlenecks scale up with robot actions and collision frequencies
        const baseLoad = 65;
        const collisionLoad = activeStats.deadlocks * 2;
        cpu = Math.min(98, baseLoad + collisionLoad + Math.floor(Math.random() * 8));
    } else {
        // Low load: Goa framework utilizes small, localized micro-services with lightweight endpoint payload
        cpu = Math.max(4, 8 + Math.floor(Math.random() * 6));
    }
    
    activeStats.cpu = cpu;
    if (currentMode === 'mono') {
        stats.mono.cpuSamples.push(cpu);
    } else {
        stats.dist.cpuSamples.push(cpu);
    }
}

// --- 8. Simulation Main Loop ---
function simLoop() {
    if (!isRunning) return;

    simulationTime++;

    // Order Spawning Logic
    const spawnThreshold = 0.005 * orderSpawnRate;
    if (Math.random() < spawnThreshold) {
        createOrder();
    }

    // Update Robots
    amrs.forEach(amr => amr.update());

    // CPU Calculation
    if (simulationTime % 20 === 0) {
        simulateCPULoad();
        updateDashboardMetrics();
        updateCharts();
    }

    // Render Scene
    drawWarehouse();

    animationFrameId = requestAnimationFrame(simLoop);
}

// --- 9. UI Controls & Dashboard Update ---
function updateDashboardMetrics() {
    document.getElementById('metric-throughput').innerText = activeStats.throughput;
    document.getElementById('metric-leadtime').innerText = activeStats.avgLeadTime;
    
    const dlBox = document.getElementById('metric-deadlocks');
    dlBox.innerText = activeStats.deadlocks;
    if (activeStats.deadlocks > 10) {
        dlBox.className = 'metric-value status-bad';
    } else {
        dlBox.className = 'metric-value status-good';
    }

    document.getElementById('metric-cpu').innerText = `${activeStats.cpu}%`;
}

function addLog(text, type = 'system') {
    const consoleBox = document.getElementById('log-output');
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    line.innerText = `[${new Date().toLocaleTimeString()}] ${text}`;
    consoleBox.appendChild(line);
    
    // Auto-scroll
    consoleBox.scrollTop = consoleBox.scrollHeight;
}

// Initialize Robots according to Mode
function initRobots() {
    amrs = [];
    if (currentMode === 'mono') {
        // 3 general-purpose robots
        amrs.push(new AMR('AMR-01', 'mono', 1, 1, 'var(--neon-cyan)'));
        amrs.push(new AMR('AMR-02', 'mono', 18, 1, 'var(--neon-cyan)'));
        amrs.push(new AMR('AMR-03', 'mono', 9, 5, 'var(--neon-cyan)'));
    } else {
        // Goa Decentralized setup
        // Aisle 1 전담
        amrs.push(new AMR('AMR-A1-01', 'aisle', MapEntities.aisle1X, 2, 'var(--neon-cyan)', 1));
        // Aisle 2 전담
        amrs.push(new AMR('AMR-A2-01', 'aisle', MapEntities.aisle2X, 2, 'var(--neon-cyan)', 2));
        // 고속 인터셉터 (Interceptor)
        amrs.push(new AMR('AMR-INT-01', 'interceptor', 0, MapEntities.interceptorCorridorY, 'var(--neon-yellow)', 'interceptor'));
    }
}

// Mode Switch Handler
function switchMode(mode) {
    if (currentMode === mode) return;
    
    currentMode = mode;
    addLog(`[System] 관제 시스템 모델 변경 -> ${mode === 'mono' ? 'Monolithic' : 'Goa Distributed (MSA + Intercept)'}`);
    
    // Switch active button class
    document.getElementById('mode-mono').classList.toggle('active', mode === 'mono');
    document.getElementById('mode-dist').classList.toggle('active', mode === 'dist');

    // Reset statistics and display
    resetSimulator();
}

function startSimulator() {
    if (isRunning) return;
    isRunning = true;
    document.getElementById('btn-start').disabled = true;
    document.getElementById('btn-pause').disabled = false;
    document.getElementById('sim-status-text').innerText = '시뮬레이션 구동 중';
    document.querySelector('.dot').classList.add('blinking');
    
    addLog(`[System] 시뮬레이션 시작. (모드: ${currentMode === 'mono' ? '중앙 단일 모드' : 'Goa 분산 인터셉터 모드'})`, 'success');
    simLoop();
}

function pauseSimulator() {
    if (!isRunning) return;
    isRunning = false;
    document.getElementById('btn-start').disabled = false;
    document.getElementById('btn-pause').disabled = true;
    document.getElementById('sim-status-text').innerText = '시뮬레이션 일시정지됨';
    document.querySelector('.dot').classList.remove('blinking');
    cancelAnimationFrame(animationFrameId);
    addLog(`[System] 시뮬레이션 일시정지.`);
}

function resetSimulator() {
    pauseSimulator();
    simulationTime = 0;
    ordersList = [];
    
    // Mode-specific reset
    activeStats = {
        throughput: currentMode === 'mono' ? stats.mono.throughput : stats.dist.throughput,
        avgLeadTime: 0.0,
        deadlocks: currentMode === 'mono' ? stats.mono.deadlocks : stats.dist.deadlocks,
        cpu: 0
    };
    
    // Reset buffer physical items
    MapEntities.buffer1.isOccupied = false;
    MapEntities.buffer1.item = null;
    MapEntities.buffer2.isOccupied = false;
    MapEntities.buffer2.item = null;

    initRobots();
    drawWarehouse();
    updateDashboardMetrics();
    addLog(`[System] 시뮬레이터가 리셋되었습니다.`, 'system');
}

// --- 10. Chart.js Implementation ---
let throughputChart, cpuChart;

function initCharts() {
    const throughputCtx = document.getElementById('chart-throughput').getContext('2d');
    const cpuCtx = document.getElementById('chart-cpu').getContext('2d');

    Chart.defaults.color = '#90a0b7';
    Chart.defaults.font.family = 'Outfit';

    throughputChart = new Chart(throughputCtx, {
        type: 'bar',
        data: {
            labels: ['Monolithic ACS', 'Goa Distributed ACS'],
            datasets: [{
                label: '총 완료 주문량 (Throughput)',
                data: [stats.mono.throughput, stats.dist.throughput],
                backgroundColor: ['#ff007f', '#00f0ff'],
                borderColor: ['rgba(255, 0, 127, 0.8)', 'rgba(0, 240, 255, 0.8)'],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
                x: { grid: { display: false } }
            }
        }
    });

    cpuChart = new Chart(cpuCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Monolithic CPU (%)',
                    data: [],
                    borderColor: '#ff007f',
                    backgroundColor: 'transparent',
                    tension: 0.3
                },
                {
                    label: 'Distributed CPU (%)',
                    data: [],
                    borderColor: '#00f0ff',
                    backgroundColor: 'transparent',
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' }
            },
            scales: {
                y: { min: 0, max: 100, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
                x: { display: false }
            }
        }
    });
}

function updateCharts() {
    // 1. Throughput Chart update
    throughputChart.data.datasets[0].data = [stats.mono.throughput, stats.dist.throughput];
    throughputChart.update('none'); // silent update

    // 2. CPU Chart update
    const sampleLength = Math.max(stats.mono.cpuSamples.length, stats.dist.cpuSamples.length);
    const labels = Array.from({ length: sampleLength }, (_, i) => i);
    
    cpuChart.data.labels = labels;
    cpuChart.data.datasets[0].data = stats.mono.cpuSamples;
    cpuChart.data.datasets[1].data = stats.dist.cpuSamples;
    cpuChart.update('none');
}

// --- 11. Event Listeners ---
document.getElementById('mode-mono').addEventListener('click', () => switchMode('mono'));
document.getElementById('mode-dist').addEventListener('click', () => switchMode('dist'));
document.getElementById('btn-start').addEventListener('click', startSimulator);
document.getElementById('btn-pause').addEventListener('click', pauseSimulator);
document.getElementById('btn-reset').addEventListener('click', resetSimulator);

document.getElementById('speed-range').addEventListener('input', (e) => {
    simulationSpeed = parseInt(e.target.value);
    addLog(`[System] 시뮬레이션 속도가 ${simulationSpeed}x로 변경되었습니다.`);
});

document.getElementById('spawn-rate').addEventListener('input', (e) => {
    orderSpawnRate = parseInt(e.target.value);
    addLog(`[System] 주문 생성 빈도가 ${orderSpawnRate}/10 단계로 변경되었습니다.`);
});

document.getElementById('btn-clear-log').addEventListener('click', () => {
    document.getElementById('log-output').innerHTML = '';
});

// Windows resize handling
window.addEventListener('resize', () => {
    // Canvas sizing handles automatically via CSS, but draw to keep intact
    drawWarehouse();
});

// App Startup
initRobots();
initCharts();
drawWarehouse();
updateDashboardMetrics();
