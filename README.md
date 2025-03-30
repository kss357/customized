# Forum Project

게시판 기능을 제공하는 웹 애플리케이션입니다.

## 주요 기능

- 게시글 작성, 조회, 수정, 삭제
- 이미지 업로드 (Bunny.net CDN 사용)
- 게시글 좋아요 기능
- 조회수 카운트
- 카테고리별 게시글 분류

## 기술 스택

- **Frontend**: HTML, CSS, JavaScript, EJS
- **Backend**: Node.js, Express
- **Database**: MongoDB
- **Image Storage**: Bunny.net CDN
- **Deployment**: 예정

## 설치 및 실행 방법

1. 저장소 클론
```bash
git clone https://github.com/kss357/customized.git
cd customized
```

2. 의존성 설치
```bash
npm install
```

3. 환경 변수 설정
- `.env` 파일 생성 후 다음 변수들 설정:
  ```
  DB_URL=MongoDB_연결_문자열
  BUNNY_STORAGE_ZONE=스토리지_존_이름
  BUNNY_API_KEY=API_키
  BUNNY_PULL_ZONE=Pull_Zone_URL
  ```

4. 서버 실행
```bash
node server.js
```

## API 엔드포인트

- `GET /list` - 게시글 목록 조회
- `GET /write` - 게시글 작성 페이지
- `POST /write` - 게시글 작성
- `GET /detail/:id` - 게시글 상세 조회
- `POST /api/like/:id` - 게시글 좋아요 토글

## 라이선스

MIT License

## 작성자

- kss357 