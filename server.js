const express = require("express");
const app = express();
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();  // .env 파일 로드
const path = require('path');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

// Express 설정
app.use(express.static('public'));
app.use(express.urlencoded({extended: true}));
app.use(express.json());
app.use(cookieParser());

// View 엔진 설정
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Bunny.net 설정
const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE;
const BUNNY_ACCESS_KEY = process.env.BUNNY_ACCESS_KEY;
const BUNNY_PULL_ZONE = process.env.BUNNY_PULL_ZONE;

// multer 설정
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const { MongoClient, ObjectId } = require('mongodb')
let db
const url = process.env.DB_URL;

// MongoDB 연결
async function connectDB() {
    try {
        if (!process.env.DB_URL) {
            throw new Error('Database URL is not defined in environment variables');
        }
        
        const client = await MongoClient.connect(process.env.DB_URL, {
            serverSelectionTimeoutMS: 5000
        });
        
        console.log('MongoDB 연결 성공');
        return client.db('forum');
    } catch (err) {
        console.error('MongoDB 연결 에러:', err);
        throw err;
    }
}

// 서버 시작
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    // 초기 DB 연결 시도
    connectDB().catch(console.error);
});

// Vercel/Render 서버리스 함수를 위한 export
module.exports = app;

// 기본 경로 리다이렉트
app.get('/', (req, res) => {
    res.redirect('/monster-hunter-wilds');
});

// 게임별 리스트 페이지
app.get('/:game', async (req, res) => {
    const game = req.params.game;
    const validGames = ['monster-hunter-wilds', 'lost-ark'];
    const userCookie = req.cookies.userId;
    
    if (!validGames.includes(game)) {
        return res.redirect('/monster-hunter-wilds');
    }

    const gameInfo = {
        'monster-hunter-wilds': {
            title: 'Monster Hunter Wilds',
            heroImage: 'https://customized.b-cdn.net/hero2.png'
        },
        'lost-ark': {
            title: 'Lost Ark',
            heroImage: 'https://customized.b-cdn.net/lost-ark-hero.png'
        }
    };

    const database = await connectDB();
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    // 전체 게시물 수 조회
    const totalPosts = await database.collection('post').countDocuments({ game: game });
    const totalPages = Math.ceil(totalPosts / limit);

    // 게시물 목록 조회 (페이지네이션 적용)
    const posts = await database.collection('post').find({ game: game })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

    res.render('list', {
        game: game,
        gameTitle: gameInfo[game].title,
        heroImage: gameInfo[game].heroImage,
        글목록: posts,
        totalPages,
        currentPage: page,
        cookies: req.cookies
    });
});

// 게임별 글쓰기 페이지
app.get('/:game/write', (req, res) => {
    const game = req.params.game;
    const validGames = ['monster-hunter-wilds', 'lost-ark'];
    
    if (!validGames.includes(game)) {
        return res.redirect('/monster-hunter-wilds');
    }

    res.render('write', { game: game });
});

app.post('/:game/write', upload.single('image'), async (req, res) => {
    try {
        const database = await connectDB();
        const game = req.params.game;
        
        // 게시물 데이터 준비
        const post = {
            title: req.body.title,
            code: req.body.code,
            content: req.body.content,
            author: req.body.author,
            game: game,
            createdAt: new Date(),
            likeCount: 0,
            likedUsers: [],
            views: 0
        };

        // 이미지가 업로드된 경우
        if (req.file) {
            // 파일 이름에서 한글과 특수문자 제거
            const originalName = req.file.originalname;
            const sanitizedName = originalName.replace(/[^a-zA-Z0-9.]/g, '_');
            const timestamp = Date.now();
            const fileName = `${timestamp}_${sanitizedName}`;

            const storageUrl = `https://sg.storage.bunnycdn.com/${process.env.BUNNY_STORAGE_ZONE}/`;
            const fileUrl = storageUrl + fileName;

            try {
                // Bunny CDN에 이미지 업로드
                await axios.put(fileUrl, req.file.buffer, {
                    headers: {
                        'AccessKey': process.env.BUNNY_ACCESS_KEY,
                        'Content-Type': req.file.mimetype
                    }
                });

                // 이미지 URL 설정
                post.imageUrl = `${process.env.BUNNY_PULL_ZONE}/${fileName}`;
            } catch (error) {
                console.error('Image upload error:', error);
                return res.status(500).send('이미지 업로드 중 오류가 발생했습니다.');
            }
        } else {
            // 기본 이미지 URL 설정
            post.imageUrl = 'https://customized.b-cdn.net/default-thumbnail.jpg';
        }

        // 게시물 저장
        const result = await database.collection('post').insertOne(post);
        
        // 작성 완료 후 해당 게임의 목록 페이지로 리다이렉트
        res.redirect(`/${game}`);
    } catch (error) {
        console.error('Write Error:', error);
        res.status(500).send('게시물 작성 중 오류가 발생했습니다.');
    }
});

// 게임별 상세 페이지
app.get('/:game/detail/:id', async (req, res) => {
    try {
        const database = await connectDB();
        const game = req.params.game;
        const result = await database.collection('post').findOne({ 
            _id: new ObjectId(req.params.id),
            game: game
        });

        if (!result) {
            res.status(404).send('게시물을 찾을 수 없습니다.');
            return;
        }

        res.render('detail', { 
            글내용: result,
            game: game,
            cookies: req.cookies
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('서버 오류가 발생했습니다.');
    }
});

app.put('/edit/:id', async (req, res) => {
    try {
        const database = await connectDB();
        const result = await database.collection('post').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: req.body }
        );
        if (result.modifiedCount === 0) {
            return res.json({ success: false, message: '수정할 게시물을 찾을 수 없습니다.' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating post:', error);
        res.json({ success: false, message: '게시물 수정에 실패했습니다.' });
    }
});

app.delete('/delete/:id', async (req, res) => {
    try {
        const database = await connectDB();
        const result = await database.collection('post').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) {
            return res.json({ success: false, message: '삭제할 게시물을 찾을 수 없습니다.' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting post:', error);
        res.json({ success: false, message: '게시물 삭제에 실패했습니다.' });
    }
});

// 이미지 업로드 API
app.post('/upload', upload.single('image'), async function(req, res) {
    try {
        console.log('=== Upload Route Start ===');
        console.log('Request file:', req.file ? {
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size
        } : 'No file uploaded');

        if (!req.file) {
            return res.json({ success: false, message: '이미지가 선택되지 않았습니다.' });
        }

        // 파일 이름에서 한글과 특수문자 제거
        const originalName = req.file.originalname;
        const sanitizedName = originalName.replace(/[^a-zA-Z0-9.]/g, '_');
        const timestamp = Date.now();
        const fileName = `${timestamp}_${sanitizedName}`;

        console.log('=== File Processing ===');
        console.log('Original filename:', originalName);
        console.log('Sanitized filename:', fileName);

        const storageUrl = `https://sg.storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}/`;
        const fileUrl = storageUrl + fileName;

        console.log('=== Upload Attempt ===');
        console.log('Upload URL:', fileUrl);
        console.log('Using AccessKey:', BUNNY_ACCESS_KEY.substring(0, 10) + '...');

        const response = await axios.put(fileUrl, req.file.buffer, {
            headers: {
                'AccessKey': BUNNY_ACCESS_KEY,
                'Content-Type': req.file.mimetype
            }
        });

        console.log('Upload response:', {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
        });

        // 수정된 이미지 URL 생성
        const imageUrl = `${BUNNY_PULL_ZONE}/${fileName}`;
        console.log('Generated image URL:', imageUrl);

        res.json({ 
            success: true, 
            imageUrl: imageUrl 
        });
    } catch (error) {
        console.error('=== Upload Route Error ===');
        console.error('Error message:', error.message);
        console.error('Error response:', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data
        });
        res.json({ 
            success: false, 
            message: '이미지 업로드 중 오류가 발생했습니다.',
            error: error.response?.data || error.message
        });
    }
});

// 좋아요 API
app.post('/api/like/:id', async (req, res) => {
    const postId = req.params.id;
    const userCookie = req.cookies.userId || crypto.randomUUID();
    
    try {
        const database = await connectDB();
        // 이미 좋아요를 눌렀는지 확인
        const post = await database.collection('post').findOne({
            _id: new ObjectId(postId),
            'likedUsers': userCookie
        });

        if (!post) {
            // 좋아요 추가
            await database.collection('post').updateOne(
                { _id: new ObjectId(postId) },
                { 
                    $inc: { likeCount: 1 },
                    $push: { likedUsers: userCookie }
                }
            );
        } else {
            // 좋아요 취소
            await database.collection('post').updateOne(
                { _id: new ObjectId(postId) },
                { 
                    $inc: { likeCount: -1 },
                    $pull: { likedUsers: userCookie }
                }
            );
        }
        
        // 쿠키가 없다면 설정
        if (!req.cookies.userId) {
            res.cookie('userId', userCookie, { maxAge: 365 * 24 * 60 * 60 * 1000 }); // 1년
        }
        
        // 업데이트된 좋아요 수 조회
        const updatedPost = await database.collection('post').findOne(
            { _id: new ObjectId(postId) }
        );
        
        res.json({ 
            success: true, 
            likes: updatedPost.likeCount || 0,
            isLiked: !post // 좋아요 상태 반환
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
    }
});

// 임시: 모든 데이터 삭제 라우트
app.get('/clear-all-data/:game', async (req, res) => {
    try {
        const game = req.params.game;
        const validGames = ['monster-hunter-wilds', 'lost-ark'];
        
        if (!validGames.includes(game)) {
            return res.status(400).json({ error: '유효하지 않은 게임입니다.' });
        }

        const database = await connectDB();
        await database.collection('post').deleteMany({ game: game });
        res.json({ message: `${game} 게시판의 모든 데이터가 삭제되었습니다.` });
    } catch (error) {
        console.error('데이터 삭제 중 오류:', error);
        res.status(500).json({ error: '데이터 삭제 중 오류가 발생했습니다.' });
    }
});

// 임시: 전체 데이터 삭제 라우트
app.get('/clear-all-data', async (req, res) => {
    try {
        const database = await connectDB();
        await database.collection('post').deleteMany({});
        res.json({ message: '모든 게임의 데이터가 삭제되었습니다.' });
    } catch (error) {
        console.error('데이터 삭제 중 오류:', error);
        res.status(500).json({ error: '데이터 삭제 중 오류가 발생했습니다.' });
    }
});

// 하루 제한 체크 API
app.get('/check-daily-limit', (req, res) => {
    try {
        const lastPostTime = req.cookies.lastPostTime;
        const now = new Date();
        
        if (lastPostTime) {
            const lastPost = new Date(lastPostTime);
            const timeDiff = now - lastPost;
            const hoursLeft = 24 - (timeDiff / (1000 * 60 * 60));
            
            if (hoursLeft > 0) {
                return res.json({
                    canWrite: false,
                    hoursLeft: Math.ceil(hoursLeft)
                });
            }
        }
        
        res.json({ canWrite: true });
    } catch (error) {
        console.error('하루 제한 체크 중 오류:', error);
        res.status(500).json({ error: '하루 제한 체크 중 오류가 발생했습니다.' });
    }
});

