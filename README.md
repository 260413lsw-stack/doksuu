# Goa API Framework 기반 분산 ACS & 인터셉터 로봇 물류 시뮬레이터

> **[초격차 학업 탐구 포트폴리오]**  
> 단일 관제 시스템(Monolithic ACS)의 병목 및 연산 과부하 현상을 Go 언어의 **Goa API 프레임워크**를 적용한 마이크로서비스 설계와 **통로 전담 & 인터셉트 로봇 협업(랑데부 버퍼)** 구조로 해결하는 시스템 설계 및 시뮬레이션 프로젝트입니다.

---

## 📂 프로젝트 디렉토리 구조

```text
├── goa-backend/                  # Goa API Design-First 아키텍처 포트폴리오
│   ├── design/
│   │   └── design.go             # Goa DSL 기반 API 명세 설계 코드
│   ├── go.mod                    # Go 모듈 파일
│   └── main.go                   # 분산 ACS 스케줄링 흐름 모사 Mock 서버
│
├── web-simulator/                # 무설치 구동형 실시간 2D/3D Mockup 웹 시뮬레이터
│   ├── index.html                # 프리미엄 다크 테마 대시보드 마크업
│   ├── style.css                 # 글래스모피즘 및 네온 디자인 CSS
│   └── app.js                    # 로봇 에이전트 모델링 & 시뮬레이션 핵심 엔진
│
├── ACS_GOA_Research_Report.md    # [학술 연구 보고서] 세특 제출용 연구 논문 양식 보고서
└── README.md                     # 본 가이드 문서
```

---

## 🛠️ 주요 기술 스택

- **Backend Architecture Design:** Go (Golang) + **Goa (goa.design)** (v3 API Design DSL)
- **Frontend Visualizer:** HTML5 Canvas, JavaScript (Vanilla ES6), CSS3 Variables & backdrop-filter
- **Data Analytics Charts:** **Chart.js** (실시간 통계 및 누적 처리량 차트 연동)
- **UI Icons:** **Lucide Icons**

---

## 🚀 시뮬레이터 실행 방법 (Zero-Install)

로컬 빌드 환경(Go, Node.js 등)이 없어도 즉시 구동 가능하도록 최적화되어 있습니다.

1. 본 레포지토리를 클론하거나 다운로드합니다.
2. `web-simulator/index.html` 파일을 크롬(Chrome)이나 엣지(Edge) 등 웹 브라우저에 **드래그 앤 드롭**하거나 **더블 클릭**하여 실행합니다.
3. 대시보드에서 다음 과정을 수행하며 성능 지표를 비교 분석합니다.
   - **Monolithic ACS 모드:** 로봇들이 제한 없이 통로를 누비며 생기는 **정체 현상(Deadlock)**과 실시간 전역 경로 연산에 따른 **중앙 CPU 부하 상승**을 관찰합니다.
   - **Goa Distributed ACS 모드:** 각 로봇이 지정된 통로만 왕복하고, 고속 인터셉터 로봇이 **Rendezvous Buffer**에서 상자를 빠르게 수거(Intercept)해 처리량이 증가하고 **CPU 부하가 급격히 낮아지는 것**을 실시간 차트로 검증합니다.

---

## 📝 학업적 심화 탐구 가치 (학생생활기록부 세특 연계)

1. **마이크로서비스 아키텍처(MSA) 응용 능력:** 시스템의 결합도를 낮추고 도메인 별 독립된 API(Goa DSL)를 설계함으로써 컴퓨터공학적 관점의 설계 및 최적화 역량 입증.
2. **동시성 및 협업 제어 알고리즘 설계:** 동선 분리를 통해 물류의 복잡도 제어 및 데드락 조건 해결 방안 고안.
3. **공학적 데이터 분석 및 문서화:** 시뮬레이터 결과 데이터를 바탕으로 한 학술 보고서(`ACS_GOA_Research_Report.md`) 작성을 통해 연구 분석 및 문제 해결력 표출.
