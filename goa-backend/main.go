package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

// AisleController는 각 통로별로 분산 실행되어 로컬 로봇들의 트래픽을 관제합니다.
type AisleController struct {
	AisleID     int
	Lock        sync.Mutex
	ActiveAMRs  map[string]string // robot_id -> status
	BufferState map[string]bool   // item_id -> occupied
}

func NewAisleController(id int) *AisleController {
	return &AisleController{
		AisleID:     id,
		ActiveAMRs:  make(map[string]string),
		BufferState: make(map[string]bool),
	}
}

func (ac *AisleController) AssignTask(robotID string, itemID string, rack string) string {
	ac.Lock.Lock()
	defer ac.Lock.Unlock()

	taskID := fmt.Sprintf("TASK-AISLE-%d-%d", ac.AisleID, time.Now().UnixNano()%100000)
	ac.ActiveAMRs[robotID] = "MOVING"
	log.Printf("[Aisle-%d] Assigned task %s to AMR %s: Pick item %s from %s", ac.AisleID, taskID, robotID, itemID, rack)
	return taskID
}

func (ac *AisleController) ReportStatus(robotID string, x, y int, status string) {
	ac.Lock.Lock()
	defer ac.Lock.Unlock()

	ac.ActiveAMRs[robotID] = status
	log.Printf("[Aisle-%d] AMR %s reported location (%d, %d) with status: %s", ac.AisleID, robotID, x, y, status)
}

// InterceptorController는 통로들 사이에 배치된 고속 이송 로봇을 관제합니다.
type InterceptorController struct {
	Lock             sync.Mutex
	ActiveInterceptors map[string]string // interceptor_id -> status
	PendingRequests    []string          // 대기 중인 인터셉트 요청 (item_ids)
}

func NewInterceptorController() *InterceptorController {
	return &InterceptorController{
		ActiveInterceptors: make(map[string]string),
		PendingRequests:    make([]string, 0),
	}
}

func (ic *InterceptorController) RequestIntercept(sourceAisle, destAisle int, itemID string) string {
	ic.Lock.Lock()
	defer ic.Lock.Unlock()

	interceptorID := "INTERCEPTOR-01"
	ic.ActiveInterceptors[interceptorID] = "RETRIEVING"
	log.Printf("[Interceptor ACS] Interceptor assigned to retrieve Item %s from Aisle %d buffer to Aisle %d", itemID, sourceAisle, destAisle)
	return interceptorID
}

func main() {
	fmt.Println("=========================================================================")
	fmt.Println("   Decentralized ACS (Autonomous Control System) Microservices Server   ")
	fmt.Println("            Built with Goa API Design-First Framework Model            ")
	fmt.Println("=========================================================================")

	// 1. 각 통로 관제 마이크로서비스 초기화 (분산 인스턴스)
	aisle1 := NewAisleController(1)
	aisle2 := NewAisleController(2)

	// 2. 고속 인터셉터 관제 서비스 초기화
	interceptorACS := NewInterceptorController()

	// 3. 동시 가상 스케줄링 시뮬레이션 예시
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var wg sync.WaitGroup

	// 통로 1 AMR 작업 실행 (Aisle 1 -> Rendezvous Buffer 1)
	wg.Add(1)
	go func() {
		defer wg.Done()
		taskID := aisle1.AssignTask("AMR-A1-01", "ITEM-101", "Rack_A_05")
		time.Sleep(1 * time.Second)
		aisle1.ReportStatus("AMR-A1-01", 1, 5, "PICKING")
		time.Sleep(1 * time.Second)
		aisle1.ReportStatus("AMR-A1-01", 1, 10, "LOADED")

		// 랑데부 버퍼 적재 완료 후 인터셉트 요청 발생
		fmt.Printf("\n>>> [Event] Item-101 loaded to Aisle-1 Buffer. Triggering Intercept request via Goa API...\n")
		assignedInt := interceptorACS.RequestIntercept(1, 2, "ITEM-101")
		aisle1.BufferState["ITEM-101"] = true
		aisle1.ReportStatus("AMR-A1-01", 1, 10, "IDLE")

		// 인터셉터 수거 시동
		time.Sleep(1 * time.Second)
		fmt.Printf(">>> [Event] Interceptor %s picked up Item-101 from Aisle-1 Buffer. Clearing Buffer 1.\n", assignedInt)
		aisle1.BufferState["ITEM-101"] = false

		// 통로 2의 버퍼로 이송
		time.Sleep(1.5 * time.Second)
		fmt.Printf(">>> [Event] Interceptor %s delivered Item-101 to Aisle-2 Rendezvous Buffer.\n")
		aisle2.BufferState["ITEM-101"] = true

		// 통로 2 AMR이 물건 수거 후 최종 목적지로 이동
		taskID2 := aisle2.AssignTask("AMR-A2-01", "ITEM-101", "Buffer_In")
		aisle2.ReportStatus("AMR-A2-01", 2, 10, "LOADED")
		time.Sleep(1 * time.Second)
		aisle2.ReportStatus("AMR-A2-01", 2, 2, "DELIVERED")
		aisle2.ReportStatus("AMR-A2-01", 2, 2, "IDLE")
		fmt.Printf(">>> [Event] Item-101 delivery completed. Task %s finished successfully.\n\n", taskID2)
	}()

	// 포트폴리오 안내를 위해 백엔드 구조가 동작하는 모식 웹서버 구동 (port 8080)
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `{"status": "online", "framework": "Goa v3", "services": ["aisle_controller", "interceptor_controller"], "message": "This is a static portfolio backend placeholder. Run the web-simulator/index.html to view the full interactive GUI simulation!"}`)
	})

	server := &http.Server{Addr: ":8080"}
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %s\n", err)
		}
	}()

	wg.Wait()
	fmt.Println(">>> Static Goa Simulation workflow test complete.")
	
	// 모식 서버는 1초 뒤 자동 중지하여 CLI 실행 완료 처리
	time.Sleep(1 * time.Second)
	server.Shutdown(ctx)
}
