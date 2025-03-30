const express = require("express");
const app = express();
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();  // .env 파일 로드
const path = require('path');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const fs = require('fs');
const { ObjectId } = require('mongodb');
const CryptoJS = require('crypto-js');

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

// 여러 이미지 업로드를 위한 필드 설정
const uploadFields = upload.fields([
    { name: 'imageFace', maxCount: 1 },
    { name: 'imageFront', maxCount: 1 },
    { name: 'imageSide', maxCount: 1 },
    { name: 'imageBack', maxCount: 1 },
    { name: 'imageDetail1', maxCount: 1 },
    { name: 'imageDetail2', maxCount: 1 }
]);

const { MongoClient } = require('mongodb')
let db
const url = process.env.DB_URL;

// 게임 정보 설정
const gameInfo = {
    'monster-hunter-wilds': {
        title: 'Monster Hunter Wilds',
        heroImage: 'https://customized.b-cdn.net/hunterwilds.png'
    },
    'lost-ark': {
        title: 'Lost Ark',
        heroImage: 'https://customized.b-cdn.net/lostark.png'
    }
};

// 비밀번호 해시 함수
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

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

// 메인 페이지 리다이렉트
app.get('/', (req, res) => {
    res.redirect('/monster-hunter-wilds');
});

// 게임별 목록 페이지
app.get('/:game', async (req, res) => {
    const game = req.params.game;
    const userCookie = req.cookies.userId;
    
    if (!gameInfo[game]) {
        return res.redirect('/monster-hunter-wilds');
    }

    try {
        const database = await connectDB();
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        // 전체 게시물 수 조회
        const totalPosts = await database.collection('post').countDocuments({ game: game });
        const totalPages = Math.ceil(totalPosts / limit);

        // 게시물 목록 조회 (페이지네이션 적용)
        const posts = await database.collection('post')
            .find({ game: game })
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
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('서버 오류가 발생했습니다.');
    }
});

// 게임별 상세 페이지
app.get('/:game/detail/:id', async (req, res) => {
    const game = req.params.game;
    const id = req.params.id;

    try {
        // ObjectId 유효성 검사 추가
        if (!ObjectId.isValid(id)) {
            console.log('Invalid ObjectId:', id);
            return res.status(404).send('게시물을 찾을 수 없습니다.');
        }

        const database = await connectDB();
        
        console.log('Searching for post with:', {
            id: id,
            game: game,
            objectId: new ObjectId(id)
        });
        
        // 게시물 조회 및 조회수 증가를 한 번의 쿼리로 처리
        const post = await database.collection('post').findOne({ 
            _id: new ObjectId(id),
            game: game 
        });

        console.log('Found post:', post);

        if (!post) {
            return res.status(404).send('게시물을 찾을 수 없습니다.');
        }

        // 조회수 증가
        await database.collection('post').updateOne(
            { _id: new ObjectId(id) },
            { $inc: { views: 1 } }
        );

        res.render('detail', { 
            글내용: post,
            game: game,
            cookies: req.cookies
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('서버 오류가 발생했습니다.');
    }
});

// 게시물 작성 페이지
app.get('/:game/write', (req, res) => {
    res.render('write.ejs', { 
        game: req.params.game,
        mode: 'write',
        post: null,
        isEdit: false
    });
});

// 게시물 작성 처리
app.post('/:game/write', uploadFields, async (req, res) => {
    try {
        const { title, content, author, code, password } = req.body;
        const game = req.params.game;
        let imageUrls = {};

        // 이미지 업로드 처리
        if (req.files) {
            for (const [fieldName, files] of Object.entries(req.files)) {
                if (files && files[0]) {
                    try {
                        const originalName = files[0].originalname;
                        const sanitizedName = originalName.replace(/[^a-zA-Z0-9.]/g, '_');
                        const timestamp = Date.now();
                        const fileName = `${timestamp}_${sanitizedName}`;

                        const storageUrl = `https://sg.storage.bunnycdn.com/${process.env.BUNNY_STORAGE_ZONE}/`;
                        const fileUrl = storageUrl + fileName;

                        const response = await axios.put(fileUrl, files[0].buffer, {
                            headers: {
                                'AccessKey': process.env.BUNNY_ACCESS_KEY,
                                'Content-Type': files[0].mimetype
                            }
                        });

                        imageUrls[fieldName] = `${process.env.BUNNY_PULL_ZONE}/${fileName}`;
                    } catch (uploadError) {
                        console.error(`${fieldName} 이미지 업로드 실패:`, uploadError);
                        imageUrls[fieldName] = null;
                    }
                }
            }
        }

        // 비밀번호가 이미 해시화되어 있는지 확인 (64자의 16진수 문자열)
        const isAlreadyHashed = /^[a-f0-9]{64}$/i.test(password);
        const hashedPassword = isAlreadyHashed ? password : CryptoJS.SHA256(password).toString();

        const post = {
            title,
            content,
            author,
            imageUrls,
            code,
            game,
            password: hashedPassword,
            createdAt: new Date(),
            views: 0,
            likeCount: 0,
            likedUsers: [],
            shareCount: 0
        };

        const database = await connectDB();
        await database.collection('post').insertOne(post);
        res.redirect(`/${game}`);
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
        
        // 먼저 현재 게시물 상태 확인
        const post = await database.collection('post').findOne({ 
            _id: new ObjectId(postId) 
        });

        if (!post) {
            return res.status(404).json({ 
                success: false, 
                message: '게시물을 찾을 수 없습니다.' 
            });
        }

        // 현재 좋아요 상태 확인
        const isCurrentlyLiked = post.likedUsers?.includes(userCookie);
        const newLikeCount = isCurrentlyLiked ? (post.likeCount - 1) : (post.likeCount + 1);
        
        // 업데이트 수행
        const result = await database.collection('post').updateOne(
            { _id: new ObjectId(postId) },
            {
                $set: {
                    likeCount: newLikeCount
                },
                [isCurrentlyLiked ? '$pull' : '$push']: {
                    likedUsers: userCookie
                }
            }
        );

        // 쿠키가 없다면 설정
        if (!req.cookies.userId) {
            res.cookie('userId', userCookie, { maxAge: 365 * 24 * 60 * 60 * 1000 }); // 1년
        }

        if (result.modifiedCount === 0) {
            return res.status(500).json({ 
                success: false, 
                message: '좋아요 업데이트에 실패했습니다.' 
            });
        }

        res.json({ 
            success: true, 
            likes: newLikeCount,
            isLiked: !isCurrentlyLiked
        });
    } catch (error) {
        console.error('Like error:', error);
        res.status(500).json({ 
            success: false, 
            message: '서버 오류가 발생했습니다.' 
        });
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

// 공유하기 API 엔드포인트
app.post('/api/share/:postId', async (req, res) => {
    try {
        const database = await connectDB();
        const post = await database.collection('post').findOne({ _id: new ObjectId(req.params.postId) });
        
        if (!post) {
            return res.status(404).json({ success: false, message: '게시물을 찾을 수 없습니다.' });
        }

        // shareCount 증가
        const updatedPost = await database.collection('post').updateOne(
            { _id: new ObjectId(req.params.postId) },
            { $inc: { shareCount: 1 } }
        );
        
        if (updatedPost.modifiedCount === 0) {
            return res.status(500).json({ success: false, message: '게시물 공유 증가에 실패했습니다.' });
        }

        res.json({ 
            success: true, 
            shares: post.shareCount + 1 
        });
    } catch (error) {
        console.error('Share error:', error);
        res.status(500).json({ 
            success: false, 
            message: '서버 오류가 발생했습니다.' 
        });
    }
});

// 코드 복사를 위한 게시물 조회 API
app.get('/api/post/:postId/code', async (req, res) => {
    try {
        const database = await connectDB();
        const post = await database.collection('post').findOne({ _id: new ObjectId(req.params.postId) });
        
        if (!post) {
            return res.status(404).json({ success: false, message: '게시물을 찾을 수 없습니다.' });
        }

        if (!post.code) {
            return res.status(404).json({ success: false, message: '코드가 없습니다.' });
        }

        res.json({ 
            success: true, 
            code: post.code 
        });
    } catch (error) {
        console.error('Get code error:', error);
        res.status(500).json({ 
            success: false, 
            message: '서버 오류가 발생했습니다.' 
        });
    }
});

// 비밀번호 검증 API
app.post('/api/verify-password/:id', async (req, res) => {
    try {
        const postId = new ObjectId(req.params.id);
        const { password } = req.body;
        
        const database = await connectDB();
        const post = await database.collection('post').findOne({ _id: postId });
        if (!post) {
            return res.json({ isValid: false });
        }

        // 입력된 비밀번호가 이미 해시화되어 있는지 확인
        const isAlreadyHashed = /^[a-f0-9]{64}$/i.test(password);
        const hashedPassword = isAlreadyHashed ? password : CryptoJS.SHA256(password).toString();
        
        const isValid = post.password === hashedPassword;
        res.json({ isValid });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ isValid: false, error: '서버 오류가 발생했습니다.' });
    }
});

// 기존 게시물 비밀번호 업데이트 (임시로 한 번만 실행)
app.get('/update-passwords', async (req, res) => {
    try {
        const database = await connectDB();
        
        // 비밀번호가 없는 모든 게시물 업데이트 (해시화된 '1234')
        const defaultHashedPassword = hashPassword('1234');
        await database.collection('post').updateMany(
            { password: { $exists: false } },
            { $set: { password: defaultHashedPassword } }
        );
        
        res.send('모든 게시물의 비밀번호가 업데이트되었습니다.');
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('서버 오류가 발생했습니다.');
    }
});

// 게시물 삭제 API
app.post('/api/delete-post/:id', async (req, res) => {
    try {
        const database = await connectDB();
        const post = await database.collection('post').findOne({ 
            _id: new ObjectId(req.params.id) 
        });

        if (!post) {
            return res.json({ 
                success: false, 
                message: '게시물을 찾을 수 없습니다.' 
            });
        }

        // 비밀번호 검증
        const hashedInputPassword = hashPassword(req.body.password);
        if (post.password !== hashedInputPassword) {
            return res.json({ 
                success: false, 
                message: '비밀번호가 일치하지 않습니다.' 
            });
        }

        // 게시물 삭제
        await database.collection('post').deleteOne({ 
            _id: new ObjectId(req.params.id) 
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Delete error:', error);
        res.json({ 
            success: false, 
            message: '게시물 삭제 중 오류가 발생했습니다.' 
        });
    }
});

// 게시물 수정 페이지
app.get('/:game/edit/:id', async (req, res) => {
    try {
        const { game, id } = req.params;
        const { password } = req.query;

        const database = await connectDB();
        const post = await database.collection('post').findOne({ 
            _id: new ObjectId(id),
            game: game
        });

        if (!post) {
            return res.redirect(`/${game}`);
        }

        // 비밀번호 검증
        if (post.password !== password) {
            return res.redirect(`/${game}`);
        }

        res.render('write', { 
            post, 
            game,
            mode: 'edit',
            password
        });
    } catch (error) {
        console.error('Edit page error:', error);
        res.status(500).send('서버 오류가 발생했습니다.');
    }
});

// 게시물 수정 처리
app.post('/:game/edit/:id', uploadFields, async (req, res) => {
    try {
        const { game, id } = req.params;
        const { title, content, author, code, password } = req.body;
        let imageUrls = {};

        // 이미지 업로드 처리
        if (req.files) {
            for (const [fieldName, files] of Object.entries(req.files)) {
                if (files && files[0]) {
                    try {
                        const originalName = files[0].originalname;
                        const sanitizedName = originalName.replace(/[^a-zA-Z0-9.]/g, '_');
                        const timestamp = Date.now();
                        const fileName = `${timestamp}_${sanitizedName}`;

                        const storageUrl = `https://sg.storage.bunnycdn.com/${process.env.BUNNY_STORAGE_ZONE}/`;
                        const fileUrl = storageUrl + fileName;

                        const response = await axios.put(fileUrl, files[0].buffer, {
                            headers: {
                                'AccessKey': process.env.BUNNY_ACCESS_KEY,
                                'Content-Type': files[0].mimetype
                            }
                        });

                        imageUrls[fieldName] = `${process.env.BUNNY_PULL_ZONE}/${fileName}`;
                    } catch (uploadError) {
                        console.error(`${fieldName} 이미지 업로드 실패:`, uploadError);
                        imageUrls[fieldName] = null;
                    }
                }
            }
        }

        // 업데이트할 데이터 준비
        const updateData = {
            title,
            content,
            author,
            code
        };

        // 새로운 이미지가 업로드된 경우에만 이미지 URL 업데이트
        if (Object.keys(imageUrls).length > 0) {
            updateData.imageUrls = imageUrls;
        }

        // 비밀번호가 입력된 경우에만 업데이트
        if (password) {
            const hashedPassword = CryptoJS.SHA256(password).toString();
            updateData.password = hashedPassword;
        }

        // 게시물 업데이트
        const database = await connectDB();
        await database.collection('post').updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
        );

        res.redirect(`/${game}/detail/${id}`);
    } catch (error) {
        console.error('Edit error:', error);
        res.status(500).send('서버 오류가 발생했습니다.');
    }
});

// 댓글 작성 API
app.post('/api/comments', async (req, res) => {
    try {
        const { postId, author, content, password } = req.body;
        const database = await connectDB();
        
        // 비밀번호 해시화
        const hashedPassword = CryptoJS.SHA256(password).toString();
        
        const comment = {
            postId: new ObjectId(postId),
            author,
            content,
            password: hashedPassword,
            createdAt: new Date()
        };

        await database.collection('comments').insertOne(comment);
        
        // 게시물의 댓글 수 업데이트
        await database.collection('post').updateOne(
            { _id: new ObjectId(postId) },
            { $inc: { commentCount: 1 } }
        );

        res.json({ success: true, comment });
    } catch (error) {
        console.error('Comment creation error:', error);
        res.status(500).json({ success: false, error: '댓글 작성 중 오류가 발생했습니다.' });
    }
});

// 댓글 목록 조회 API
app.get('/api/comments/:postId', async (req, res) => {
    try {
        const { postId } = req.params;
        const database = await connectDB();
        
        const comments = await database.collection('comments')
            .find({ postId: new ObjectId(postId) })
            .sort({ createdAt: -1 })
            .toArray();

        res.json({ success: true, comments });
    } catch (error) {
        console.error('Comment retrieval error:', error);
        res.status(500).json({ success: false, error: '댓글 목록을 불러오는 중 오류가 발생했습니다.' });
    }
});

// 댓글 삭제 API
app.delete('/api/comments/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { password } = req.body;
        
        const database = await connectDB();
        const comment = await database.collection('comments').findOne({ _id: new ObjectId(id) });
        
        if (!comment) {
            return res.status(404).json({ success: false, error: '댓글을 찾을 수 없습니다.' });
        }

        // 비밀번호 검증
        const hashedPassword = CryptoJS.SHA256(password).toString();
        if (comment.password !== hashedPassword) {
            return res.status(403).json({ success: false, error: '비밀번호가 일치하지 않습니다.' });
        }

        // 댓글 삭제
        await database.collection('comments').deleteOne({ _id: new ObjectId(id) });
        
        // 게시물의 댓글 수 감소
        await database.collection('post').updateOne(
            { _id: comment.postId },
            { $inc: { commentCount: -1 } }
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Comment deletion error:', error);
        res.status(500).json({ success: false, error: '댓글 삭제 중 오류가 발생했습니다.' });
    }
});

