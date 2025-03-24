// 게시글 작성
async function createPost(event) {
    event.preventDefault();
    
    const title = document.getElementById('title').value;
    const content = document.getElementById('content').value;
    
    try {
        const response = await fetch('/api/posts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ title, content })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            if (response.status === 429) {
                // 하루 제한에 도달한 경우
                const hoursLeft = data.hoursLeft;
                alert(`하루에 한 번만 등록할 수 있습니다.\n다음 등록 가능 시간까지 ${hoursLeft}시간 남았습니다.`);
                return;
            }
            throw new Error(data.error || '게시글 작성 중 오류가 발생했습니다.');
        }
        
        // 성공적으로 게시글 작성된 경우
        window.location.href = '/';
    } catch (error) {
        console.error('게시글 작성 중 오류:', error);
        alert(error.message);
    }
} 