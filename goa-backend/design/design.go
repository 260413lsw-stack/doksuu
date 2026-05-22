package design

import (
	. "goa.design/goa/v3/dsl"
)

// API 정의
var _ = API("acs_logistics", func() {
	Title("Decentralized ACS & Interceptor Logistics System API")
	Description("Goa API Design-First framework로 설계된 분산 AGV/AMR 관제 시스템 API")
	Version("1.0")
	Server("acs_server", func() {
		Host("localhost", func() {
			URI("http://localhost:8080")
			URI("grpc://localhost:8089")
		})
	})
})

// 1. 통로 관제 서비스 (Aisle Controller Service)
// 각 통로의 로봇들을 로컬에서 독립적으로 제어하여 중앙 병목 현상을 방지
var _ = Service("aisle", func() {
	Description("특정 통로(Aisle) 내부의 AMR 전담 관제 서비스")

	// 로봇에게 작업(피킹 및 이송) 할당
	Method("assign_task", func() {
		Description("통로 전담 AMR에 피킹 및 랑데부 버퍼 이송 작업을 할당합니다.")
		Payload(func() {
			Field(1, "aisle_id", Int, "통로 식별 ID", func() { Minimum(1); Maximum(10) })
			Field(2, "robot_id", String, "작업을 수행할 AMR ID")
			Field(3, "source_rack", String, "피킹할 랙 위치 (예: Rack_A_12)")
			Field(4, "item_id", String, "이송할 아이템 식별자")
			Required("aisle_id", "robot_id", "source_rack", "item_id")
		})
		Result(func() {
			Field(1, "task_id", String, "생성된 태스크 고유 ID")
			Field(2, "estimated_time", Int, "예상 소요 시간 (초)")
			Required("task_id", "estimated_time")
		})
		HTTP(func() {
			POST("/aisle/{aisle_id}/task")
			Response(StatusOK)
		})
		GRPC(func() {
			Response(CodeOK)
		})
	})

	// 로봇의 실시간 상태 및 위치 보고
	Method("report_status", func() {
		Description("통로 전담 AMR이 관제 서버에 현재 좌표 및 버퍼 상태를 보고합니다.")
		Payload(func() {
			Field(1, "aisle_id", Int, "통로 ID")
			Field(2, "robot_id", String, "AMR ID")
			Field(3, "current_x", Int, "현재 X 좌표")
			Field(4, "current_y", Int, "현재 Y 좌표")
			Field(5, "status", String, "현재 상태 (IDLE, MOVING, PICKING, LOADED, ERROR)")
			Field(6, "payload_id", String, "적재된 아이템 ID (없으면 빈 문자열)")
			Required("aisle_id", "robot_id", "current_x", "current_y", "status")
		})
		Result(func() {
			Field(1, "acknowledged", Boolean, "수신 완료 여부")
			Required("acknowledged")
		})
		HTTP(func() {
			POST("/aisle/{aisle_id}/robot/{robot_id}/status")
			Response(StatusOK)
		})
		GRPC(func() {
			Response(CodeOK)
		})
	})

	// 랑데부 버퍼 상태 조회
	Method("get_buffer_state", func() {
		Description("통로 끝에 위치한 랑데부 버퍼의 현재 적재 상태를 확인합니다.")
		Payload(func() {
			Field(1, "aisle_id", Int, "통로 ID")
			Required("aisle_id")
		})
		Result(func() {
			Field(1, "aisle_id", Int, "통로 ID")
			Field(2, "is_occupied", Boolean, "버퍼 점유(물건 존재) 여부")
			Field(3, "item_id", String, "대기 중인 아이템 ID (비어 있으면 빈 문자열)")
			Required("aisle_id", "is_occupied")
		})
		HTTP(func() {
			GET("/aisle/{aisle_id}/buffer")
			Response(StatusOK)
		})
		GRPC(func() {
			Response(CodeOK)
		})
	})
})

// 2. 인터셉터 관제 서비스 (Interceptor Controller Service)
// 통로 간 물품을 수거하여 목적지까지 가속 배송하는 고속 인터셉터 제어
var _ = Service("interceptor", func() {
	Description("통로 간 물품 이송을 전담하는 고속 인터셉터 AMR 관제 서비스")

	// 인터셉트 요청 (통로 로봇이 랑데부 버퍼에 물건을 안착시킨 후 호출)
	Method("request_intercept", func() {
		Description("통로 전담 로봇이 물품을 랑데부 버퍼에 거치한 후, 인터셉터에 수거를 요청합니다.")
		Payload(func() {
			Field(1, "source_aisle_id", Int, "출발지 통로 ID")
			Field(2, "dest_aisle_id", Int, "목적지 통로 ID (또는 출하대 ID)")
			Field(3, "item_id", String, "이송할 아이템 ID")
			Required("source_aisle_id", "dest_aisle_id", "item_id")
		})
		Result(func() {
			Field(1, "assigned_interceptor_id", String, "배정된 인터셉터 AMR ID")
			Field(2, "estimated_arrival", Int, "랑데부 버퍼까지의 예상 도착 시간 (초)")
			Required("assigned_interceptor_id", "estimated_arrival")
		})
		HTTP(func() {
			POST("/interceptor/request")
			Response(StatusAccepted)
		})
		GRPC(func() {
			Response(CodeOK)
		})
	})

	// 인터셉터 상태 보고
	Method("report_status", func() {
		Description("인터셉터 AMR이 관제 서버에 상태를 실시간 보고합니다.")
		Payload(func() {
			Field(1, "interceptor_id", String, "인터셉터 ID")
			Field(2, "current_x", Int, "현재 X 좌표")
			Field(3, "current_y", Int, "현재 Y 좌표")
			Field(4, "status", String, "현재 상태 (IDLE, RETRIEVING, DELIVERING, RETURN_TO_BASE)")
			Field(5, "assigned_task_id", String, "진행 중인 이송 태스크 ID")
			Required("interceptor_id", "current_x", "current_y", "status")
		})
		Result(func() {
			Field(1, "next_waypoint_x", Int, "다음 이동할 X 좌표")
			Field(2, "next_waypoint_y", Int, "다음 이동할 Y 좌표")
			Required("next_waypoint_x", "next_waypoint_y")
		})
		HTTP(func() {
			POST("/interceptor/{interceptor_id}/status")
			Response(StatusOK)
		})
		GRPC(func() {
			Response(CodeOK)
		})
	})
})
